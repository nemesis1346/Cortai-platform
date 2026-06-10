import uuid
from datetime import UTC, datetime, timedelta

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
async def seeded_org_thread_with_messages() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()
    guest_id = uuid.uuid4()
    thread_pk = uuid.uuid4()
    msg_1 = uuid.uuid4()
    msg_2 = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="Messaging Org 2", slug=f"msg2-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status, room_count)
                values (:p, :org, 'Hotel Msg2', :slug, :now, :now, 'ACTIVE', 200)
                """
            ),
            {"p": prop_id, "org": org_id, "slug": f"hotel-msg2-{org_id}", "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.guests (id, org_id, first_name, last_name, vip, language, phone_e164, email, preferences_json, created_at, updated_at)
                values (:g, :org, 'Ana', 'Lopez', false, 'en', null, 'ana@example.com', '{}'::jsonb, :now, :now)
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
                  (:tpk, :org, :prop, 'thread-x', :g, 'sms', 'open', null, 1, :last, :now, :now)
                """
            ),
            {"tpk": thread_pk, "org": org_id, "prop": prop_id, "g": guest_id, "last": now, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.guest_messages (
                  id, org_id, thread_id, channel, direction, guest_id, body, status, sent_at, created_at, updated_at
                )
                values
                  (:m1, :org, 'thread-x', 'sms', 'in', :g, 'Hello', null, :t1, :now, :now),
                  (:m2, :org, 'thread-x', 'sms', 'out', :g, 'Hi there', null, :t2, :now, :now)
                """
            ),
            {
                "m1": msg_1,
                "m2": msg_2,
                "org": org_id,
                "g": guest_id,
                "t1": now - timedelta(minutes=3),
                "t2": now - timedelta(minutes=1),
                "now": now,
            },
        )
        await session.commit()

    yield {"org_id": org_id, "thread_pk": thread_pk}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.guest_messages where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guest_message_threads where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guests where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_messaging_thread_messages_list(seeded_org_thread_with_messages) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_org_thread_with_messages["org_id"]
    thread_pk = seeded_org_thread_with_messages["thread_pk"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/messaging/threads/{thread_pk}/messages")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body["items"], list)
    assert len(body["items"]) == 2
    assert body["items"][0]["direction"] == "in"
    assert body["items"][1]["direction"] == "out"


@pytest.mark.asyncio
async def test_messaging_thread_messages_404_when_thread_missing(seeded_org_thread_with_messages) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_org_thread_with_messages["org_id"]
    missing = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/messaging/threads/{missing}/messages")
    assert resp.status_code == 404

