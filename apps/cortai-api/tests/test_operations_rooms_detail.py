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
async def seeded_room_detail() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)

    prop_a = uuid.uuid4()
    room_101 = uuid.uuid4()
    guest_1 = uuid.uuid4()
    res_1 = uuid.uuid4()
    incident_1 = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="Rooms Detail Org", slug=f"rooms-detail-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status, room_count)
                values (:p1, :org, 'Hotel A', 'hotel-a', :now, :now, 'ACTIVE', 200)
                """
            ),
            {"p1": prop_a, "org": org_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.rooms (id, org_id, property_id, room_number, floor, type, status, vip, created_at, updated_at, last_service_at)
                values (:r101, :org, :p1, '101', 1, 'king', 'occupied', false, :now, :now, :now)
                """
            ),
            {"r101": room_101, "org": org_id, "p1": prop_a, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.guests (id, org_id, first_name, last_name, vip, language, email, created_at, updated_at)
                values (:g, :org, 'A', 'Guest', true, 'en', 'a@example.com', :now, :now)
                """
            ),
            {"g": guest_1, "org": org_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.reservations (
                  id, org_id, guest_id, property_id, room_id, status,
                  check_in_at, check_out_at, rate_cents, group_id, source,
                  created_at, updated_at
                )
                values (
                  :res, :org, :g, :prop, :room, 'checked_in',
                  :in_at, :out_at, 10000, null, 'pms',
                  :now, :now
                )
                """
            ),
            {
                "res": res_1,
                "org": org_id,
                "g": guest_1,
                "prop": prop_a,
                "room": room_101,
                "in_at": now - timedelta(hours=1),
                "out_at": now + timedelta(days=1),
                "now": now,
            },
        )
        await session.execute(
            text(
                """
                insert into operations.incidents (
                  id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at
                )
                values (:id, :org, :prop, 'HIGH', 'OPEN', 'Room incident', 'test', null, :now, null)
                """
            ),
            {"id": incident_1, "org": org_id, "prop": prop_a, "now": now},
        )
        await session.commit()

    yield {"org_id": org_id, "room_id": room_101}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from operations.incidents where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.reservations where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guests where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.rooms where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_room_detail_includes_current_reservation_and_recent_incidents(seeded_room_detail) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_room_detail["org_id"]
    room_id = seeded_room_detail["room_id"]

    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/rooms/{room_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["room"]["id"] == str(room_id)
    assert body["current_reservation"] is not None
    assert body["current_reservation"]["status"] == "checked_in"
    assert body["current_reservation"]["guest"]["vip"] is True
    assert isinstance(body["recent_incidents"], list)
    assert len(body["recent_incidents"]) >= 1


@pytest.mark.asyncio
async def test_room_detail_404_when_missing(seeded_room_detail) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_room_detail["org_id"]
    missing = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/rooms/{missing}")
    assert resp.status_code == 404

