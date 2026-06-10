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
async def seeded_org_with_threads() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()
    guest_a = uuid.uuid4()
    guest_b = uuid.uuid4()
    thread_a = uuid.uuid4()
    thread_b = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="Messaging Org", slug=f"msg-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status, room_count)
                values (:p, :org, 'Hotel Msg', :slug, :now, :now, 'ACTIVE', 200)
                """
            ),
            {"p": prop_id, "org": org_id, "slug": f"hotel-msg-{org_id}", "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.guests (id, org_id, first_name, last_name, vip, language, phone_e164, email, preferences_json, created_at, updated_at)
                values
                  (:ga, :org, 'Alice', 'Wong', false, 'en', null, 'alice@example.com', '{}'::jsonb, :now, :now),
                  (:gb, :org, 'Bob', 'Martin', false, 'fr', null, 'bob@example.com', '{}'::jsonb, :now, :now)
                """
            ),
            {"ga": guest_a, "gb": guest_b, "org": org_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.guest_message_threads (
                  id, org_id, property_id, thread_id, guest_id, channel, status,
                  assigned_to_user_id, unread_count, last_message_at, created_at, updated_at
                )
                values
                  (:ta, :org, :prop, 'thread-a', :ga, 'sms', 'open', null, 2, :last_a, :now, :now),
                  (:tb, :org, :prop, 'thread-b', :gb, 'email', 'closed', null, 0, :last_b, :now, :now)
                """
            ),
            {
                "ta": thread_a,
                "tb": thread_b,
                "org": org_id,
                "prop": prop_id,
                "ga": guest_a,
                "gb": guest_b,
                "last_a": now - timedelta(minutes=5),
                "last_b": now - timedelta(minutes=30),
                "now": now,
            },
        )
        await session.commit()

    yield {"org_id": org_id, "property_id": prop_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.guest_message_threads where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guest_messages where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guest_message_templates where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guests where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_messaging_threads_list_returns_items(seeded_org_with_threads) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_org_with_threads["org_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get("/api/operations/messaging/threads")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body["items"], list)
    assert len(body["items"]) == 2
    assert "thread_id" in body["items"][0]
    assert "guest_first_name" in body["items"][0]


@pytest.mark.asyncio
async def test_messaging_threads_list_filters(seeded_org_with_threads) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_org_with_threads["org_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get("/api/operations/messaging/threads?channel=sms&status=open")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["channel"] == "sms"
    assert body["items"][0]["status"] == "open"


@pytest.mark.asyncio
async def test_messaging_threads_list_guest_search(seeded_org_with_threads) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_org_with_threads["org_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get("/api/operations/messaging/threads?guest=Alice")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["guest_first_name"] == "Alice"

