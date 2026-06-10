import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.auth.dependencies import get_principal
from app.auth.schemas import Principal
from app.db import SessionLocal, get_session, set_current_org
from app.main import create_app
from app.models import Organization, UserRole


def _client_for_org(*, org_id: uuid.UUID) -> AsyncClient:
    app = create_app()

    async def override_principal() -> Principal:
        return Principal(user_id=uuid.uuid4(), org_id=org_id, email="user@example.com", role=UserRole.STAFF)

    async def override_session():  # type: ignore[no-untyped-def]
        async with SessionLocal() as session:
            await set_current_org(session, str(org_id))
            yield session

    app.dependency_overrides[get_principal] = override_principal
    app.dependency_overrides[get_session] = override_session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest_asyncio.fixture
async def seeded_demo_gate_thread() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()
    guest_id = uuid.uuid4()
    thread_pk = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="Messaging Demo Org", slug=f"msg-demo-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status, room_count)
                values (:p, :org, 'Hotel Demo', :slug, :now, :now, 'ACTIVE', 200)
                """
            ),
            {"p": prop_id, "org": org_id, "slug": f"hotel-demo-{org_id}", "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.guests (id, org_id, first_name, last_name, vip, language, phone_e164, email, preferences_json, created_at, updated_at)
                values (:g, :org, 'Demo', 'Guest', false, 'en', null, 'demo@example.com', '{}'::jsonb, :now, :now)
                """
            ),
            {"g": guest_id, "org": org_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.guest_message_threads (
                  id, org_id, property_id, thread_id, guest_id, channel, status,
                  assigned_to_user_id, unread_count, last_message_at, created_at, updated_at
                )
                values
                  (:tpk, :org, :prop, 'thread-demo-gate', :g, 'sms', 'open', null, 0, null, :now, :now)
                """
            ),
            {"tpk": thread_pk, "org": org_id, "prop": prop_id, "g": guest_id, "now": now},
        )
        await session.commit()

    yield {"org_id": org_id, "thread_pk": thread_pk}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from realtime.event_log where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guest_messages where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guest_message_threads where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guests where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_demo_gate_send_message_creates_fake_inbound_reply(seeded_demo_gate_thread) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_demo_gate_thread["org_id"]
    thread_pk = seeded_demo_gate_thread["thread_pk"]

    async with _client_for_org(org_id=org_id) as client:
        resp = await client.post(
            f"/api/operations/messaging/threads/{thread_pk}/messages",
            headers={"accept-language": "en"},
            json={"body": "Hello demo gate"},
        )
    assert resp.status_code == 201

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        directions = (
            await session.execute(
                text(
                    """
                    select direction, body
                    from ops.guest_messages
                    where org_id = :org and thread_id = 'thread-demo-gate'
                    order by sent_at asc
                    """
                ),
                {"org": org_id},
            )
        ).mappings().all()
        received_events = await session.scalar(
            text("select count(*) from realtime.event_log where org_id = :org and type = 'message.received'"),
            {"org": org_id},
        )

    assert [row["direction"] for row in directions] == ["out", "in"]
    assert "Fake Twilio reply" in str(directions[1]["body"])
    assert int(received_events or 0) == 1

