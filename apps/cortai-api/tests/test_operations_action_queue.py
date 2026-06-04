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
async def seeded_action_queue() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    other_org = uuid.uuid4()
    now = datetime.now(UTC)
    room_a = uuid.uuid4()
    room_b = uuid.uuid4()

    q1 = uuid.uuid4()
    q2 = uuid.uuid4()
    q3 = uuid.uuid4()
    other_q = uuid.uuid4()

    async with SessionLocal() as session:
        session.add_all(
            [
                Organization(id=org_id, name="AQ Org", slug=f"aq-{org_id}"),
                Organization(id=other_org, name="AQ Other", slug=f"aq-{other_org}"),
            ]
        )
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        # action_queue.room_id has an FK to ops.rooms; seed rooms first.
        await session.execute(
            text(
                """
                insert into ops.rooms (id, org_id, room_number, floor, type, status, vip, created_at, updated_at)
                values
                  (:room_a, :org, '101', 1, 'king', 'vacant_clean', false, :now, :now),
                  (:room_b, :org, '102', 1, 'queen', 'vacant_clean', false, :now, :now)
                """
            ),
            {"room_a": room_a, "room_b": room_b, "org": org_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.action_queue (
                  id, org_id, type, source, room_id, guest_id, title,
                  status, severity, assigned_to_user_id, sla_due_at, completed_at, parent_incident_id,
                  created_at, updated_at
                )
                values
                  (:q1, :org, 'request', 'Guest', :room_a, null, 'Extra towels', 'pending', 'low', null, null, null, null, :t1, :t1),
                  (:q2, :org, 'incident', 'System', :room_a, null, 'Leak detected', 'urgent', 'urgent', null, :sla, null, null, :t2, :t2),
                  (:q3, :org, 'task', 'Front Desk', :room_b, null, 'Welcome note', 'assigned', 'medium', null, null, null, null, :t3, :t3)
                """
            ),
            {
                "q1": q1,
                "q2": q2,
                "q3": q3,
                "org": org_id,
                "room_a": room_a,
                "room_b": room_b,
                "t1": now - timedelta(minutes=10),
                "t2": now - timedelta(minutes=5),
                "t3": now - timedelta(minutes=1),
                "sla": now + timedelta(minutes=30),
            },
        )
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(other_org))
        await session.execute(
            text(
                """
                insert into ops.action_queue (
                  id, org_id, type, source, room_id, guest_id, title,
                  status, severity, assigned_to_user_id, sla_due_at, completed_at, parent_incident_id,
                  created_at, updated_at
                )
                values (:id, :org, 'request', 'Other', null, null, 'Other org', 'pending', 'low', null, null, null, null, :now, :now)
                """
            ),
            {"id": other_q, "org": other_org, "now": now},
        )
        await session.commit()

    yield {"org_id": org_id, "room_a": room_a, "room_b": room_b}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.action_queue where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.rooms where org_id = :org"), {"org": org_id})
        await set_current_org(session, str(other_org))
        await session.execute(text("delete from ops.action_queue where org_id = :org"), {"org": other_org})
        await session.execute(
            text("delete from organizations where id in (:a, :b)"),
            {"a": org_id, "b": other_org},
        )
        await session.commit()


@pytest.mark.asyncio
async def test_action_queue_list_is_scoped_and_returns_cursor(seeded_action_queue) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_action_queue["org_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get("/api/operations/action-queue?limit=2")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 2
    assert body["next_cursor"] is not None
    assert all(item["org_id"] == str(org_id) for item in body["items"])


@pytest.mark.asyncio
async def test_action_queue_cursor_paginates(seeded_action_queue) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_action_queue["org_id"]
    async with _client_for_org(org_id=org_id) as client:
        first = await client.get("/api/operations/action-queue?limit=2")
        cursor = first.json()["next_cursor"]
        second = await client.get(f"/api/operations/action-queue?limit=2&cursor={cursor}")

    assert first.status_code == 200
    assert second.status_code == 200
    first_ids = {item["id"] for item in first.json()["items"]}
    second_ids = {item["id"] for item in second.json()["items"]}
    assert first_ids.isdisjoint(second_ids)
    assert len(second.json()["items"]) == 1


@pytest.mark.asyncio
async def test_action_queue_filters_by_status_type_room(seeded_action_queue) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_action_queue["org_id"]
    room_a = seeded_action_queue["room_a"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/action-queue?status=urgent&type=incident&room={room_a}")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["status"] == "urgent"
    assert body["items"][0]["type"] == "incident"
    assert body["items"][0]["room_id"] == str(room_a)

