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
from app.models import Organization, User, UserRole, UserStatus


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


@pytest.mark.asyncio
async def test_operations_kpis_returns_expected_shape() -> None:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)

    room_1 = uuid.uuid4()
    room_2 = uuid.uuid4()
    room_3 = uuid.uuid4()
    guest_1 = uuid.uuid4()
    guest_2 = uuid.uuid4()
    reservation_1 = uuid.uuid4()
    reservation_2 = uuid.uuid4()
    prop_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="KPIs Org", slug=f"kpis-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        # Create one ACTIVE user; we treat this as staff on site/on duty for now.
        session.add(
            User(
                id=uuid.uuid4(),
                org_id=org_id,
                email=f"kpis-{org_id}@example.com",
                full_name="KPI Staff",
                role=UserRole.STAFF,
                status=UserStatus.ACTIVE,
                password_hash="hash",  # noqa: S106
                created_at=now,
                updated_at=now,
            )
        )
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status)
                values (:id, :org_id, 'KPI Hotel', :slug, :now, :now, 'ACTIVE')
                """
            ),
            {"id": prop_id, "org_id": org_id, "slug": f"kpi-hotel-{org_id}", "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.rooms (id, org_id, property_id, room_number, floor, type, status, vip, created_at, updated_at)
                values
                  (:r1, :org_id, :prop, '101', 1, 'king', 'occupied', false, :now, :now),
                  (:r2, :org_id, :prop, '102', 1, 'queen', 'vacant_clean', false, :now, :now),
                  (:r3, :org_id, :prop, '103', 1, 'king', 'vacant_dirty', false, :now, :now)
                """
            ),
            {"r1": room_1, "r2": room_2, "r3": room_3, "org_id": org_id, "prop": prop_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.guests (id, org_id, first_name, last_name, vip, language, created_at, updated_at)
                values
                  (:g1, :org_id, 'A', 'Guest', false, 'en', :now, :now),
                  (:g2, :org_id, 'B', 'Guest', false, 'en', :now, :now)
                """
            ),
            {"g1": guest_1, "g2": guest_2, "org_id": org_id, "now": now},
        )

        # One checked-in reservation in occupied room; one booked arriving today.
        await session.execute(
            text(
                """
                insert into ops.reservations (
                  id, org_id, guest_id, property_id, room_id, status,
                  check_in_at, check_out_at, rate_cents, group_id, source,
                  created_at, updated_at
                )
                values
                  (:res1, :org_id, :g1, :prop, :r1, 'checked_in',
                   :check_in_1, :check_out_1, 10000, null, 'pms', :now, :now),
                  (:res2, :org_id, :g2, :prop, null, 'booked',
                   :check_in_2, :check_out_2, 12000, null, 'pms', :now, :now)
                """
            ),
            {
                "res1": reservation_1,
                "res2": reservation_2,
                "org_id": org_id,
                "g1": guest_1,
                "g2": guest_2,
                "prop": prop_id,
                "r1": room_1,
                "check_in_1": now - timedelta(hours=2),
                "check_out_1": now + timedelta(days=1),
                "check_in_2": now + timedelta(hours=3),
                "check_out_2": now + timedelta(days=2),
                "now": now,
            },
        )
        await session.commit()

    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get("/api/operations/kpis")

    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {
        "occupancy_pct",
        "occupancy_rooms",
        "guests_in_hotel",
        "guests_total_capacity",
        "staff_on_site",
        "staff_on_duty",
        "arrivals_today",
        "departures_today",
        "rooms_ready",
        "rooms_cleaning",
    }

    assert body["occupancy_rooms"] == {"used": 1, "total": 3}
    assert body["occupancy_pct"] == pytest.approx((1 / 3) * 100.0)
    assert body["rooms_ready"] == 1
    assert body["rooms_cleaning"] == 1

    assert body["guests_in_hotel"] == 1
    assert body["guests_total_capacity"] == 6

    assert body["staff_on_site"] == 1
    assert body["staff_on_duty"] == 1

    assert body["arrivals_today"]["count"] == 2
    assert body["arrivals_today"]["arrived"] == 1
    assert body["departures_today"]["count"] == 0
    assert body["departures_today"]["departed"] == 0

    # cleanup
    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.reservations where org_id = :org_id"), {"org_id": org_id})
        await session.execute(text("delete from ops.guests where org_id = :org_id"), {"org_id": org_id})
        await session.execute(text("delete from ops.rooms where org_id = :org_id"), {"org_id": org_id})
        await session.execute(text("delete from users where org_id = :org_id"), {"org_id": org_id})
        await session.execute(text("delete from properties where org_id = :org_id"), {"org_id": org_id})
        await session.execute(text("delete from organizations where id = :org_id"), {"org_id": org_id})
        await session.commit()

