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
async def seeded_org_thread_for_assign() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()
    guest_id = uuid.uuid4()
    thread_pk = uuid.uuid4()
    user_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="Messaging Org Assign", slug=f"msg-assign-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status, room_count)
                values (:p, :org, 'Hotel Assign', :slug, :now, :now, 'ACTIVE', 200)
                """
            ),
            {"p": prop_id, "org": org_id, "slug": f"hotel-assign-{org_id}", "now": now},
        )
        await session.execute(
            text(
                """
                insert into users (id, org_id, email, full_name, role, status, password_hash, created_at, updated_at)
                values (:u, :org, 'assignee@example.com', 'Assignee', 'STAFF', 'ACTIVE', 'hash', :now, :now)
                """
            ),
            {"u": user_id, "org": org_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.guests (id, org_id, first_name, last_name, vip, language, phone_e164, email, preferences_json, created_at, updated_at)
                values (:g, :org, 'Pat', 'Lee', false, 'en', null, 'pat@example.com', '{}'::jsonb, :now, :now)
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
                  (:tpk, :org, :prop, 'thread-assign', :g, 'sms', 'open', null, 0, null, :now, :now)
                """
            ),
            {"tpk": thread_pk, "org": org_id, "prop": prop_id, "g": guest_id, "now": now},
        )
        await session.commit()

    yield {"org_id": org_id, "thread_pk": thread_pk, "assignee_user_id": user_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from realtime.event_log where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guest_message_threads where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guests where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from users where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_messaging_thread_assign(seeded_org_thread_for_assign) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_org_thread_for_assign["org_id"]
    thread_pk = seeded_org_thread_for_assign["thread_pk"]
    assignee = seeded_org_thread_for_assign["assignee_user_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.post(
            f"/api/operations/messaging/threads/{thread_pk}/assign",
            json={"assigned_to_user_id": str(assignee)},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["assigned_to_user_id"] == str(assignee)


@pytest.mark.asyncio
async def test_messaging_thread_assign_404_when_thread_missing(seeded_org_thread_for_assign) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_org_thread_for_assign["org_id"]
    missing = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.post(
            f"/api/operations/messaging/threads/{missing}/assign",
            json={"assigned_to_user_id": None},
        )
    assert resp.status_code == 404

