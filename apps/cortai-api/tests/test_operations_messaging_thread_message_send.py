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
from app.operations import messaging_dispatch


def _client_for_org(*, org_id: uuid.UUID) -> AsyncClient:
    app = create_app()

    async def override_principal() -> Principal:
        return Principal(user_id=uuid.uuid4(), org_id=org_id, email="user@example.com", role=UserRole.STAFF)

    async def override_session():  # type: ignore[no-untyped-def]
        async with SessionLocal() as session:
            await set_current_org(session, str(org_id))
            yield session

    async def fake_dispatch(*, request, payload):  # type: ignore[no-untyped-def]
        # Deterministic stub for tests.
        assert "thread_id" in payload
        assert "message_id" in payload
        assert "body" in payload
        return {"ok": True}

    app.dependency_overrides[get_principal] = override_principal
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[messaging_dispatch.dispatch_outbound_message] = fake_dispatch
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest_asyncio.fixture
async def seeded_org_thread_for_send() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()
    guest_id = uuid.uuid4()
    thread_pk = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="Messaging Org 3", slug=f"msg3-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status, room_count)
                values (:p, :org, 'Hotel Msg3', :slug, :now, :now, 'ACTIVE', 200)
                """
            ),
            {"p": prop_id, "org": org_id, "slug": f"hotel-msg3-{org_id}", "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.guests (id, org_id, first_name, last_name, vip, language, phone_e164, email, preferences_json, created_at, updated_at)
                values (:g, :org, 'Zoe', 'Chen', false, 'fr', null, 'zoe@example.com', '{}'::jsonb, :now, :now)
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
                  (:tpk, :org, :prop, 'thread-send', :g, 'sms', 'open', null, 0, null, :now, :now)
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
async def test_messaging_send_message_uses_accept_language_fallback(seeded_org_thread_for_send) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_org_thread_for_send["org_id"]
    thread_pk = seeded_org_thread_for_send["thread_pk"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.post(
            f"/api/operations/messaging/threads/{thread_pk}/messages",
            headers={"accept-language": "fr-CA,fr;q=0.9,en;q=0.8"},
            json={"body": "Bonjour"},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["message"]["direction"] == "out"
    assert body["message"]["language"] == "fr"

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        count = await session.scalar(
            text("select count(*) from realtime.event_log where org_id = :org and type = 'message.sent'"),
            {"org": org_id},
        )
    assert int(count or 0) == 1

