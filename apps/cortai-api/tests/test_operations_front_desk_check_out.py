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
async def seeded_check_out() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()
    room_id = uuid.uuid4()
    guest_id = uuid.uuid4()
    reservation_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="FD CheckOut Org", slug=f"fd-checkout-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status)
                values (:id, :org_id, 'FD Hotel', :slug, :now, :now, 'ACTIVE')
                """
            ),
            {"id": prop_id, "org_id": org_id, "slug": f"fd-hotel-{org_id}", "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.rooms (
                  id, org_id, property_id, room_number, floor, type, status,
                  current_reservation_id, vip, created_at, updated_at
                )
                values (
                  :room_id, :org_id, :prop_id, '101', 1, 'king', 'occupied',
                  :rid, false, :now, :now
                )
                """
            ),
            {"room_id": room_id, "org_id": org_id, "prop_id": prop_id, "rid": reservation_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.guests (id, org_id, first_name, last_name, vip, language, created_at, updated_at)
                values (:gid, :org_id, 'A', 'Guest', false, 'en', :now, :now)
                """
            ),
            {"gid": guest_id, "org_id": org_id, "now": now},
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
                  :rid, :org_id, :gid, :prop_id, :room_id, 'checked_in',
                  :in_at, :out_at, 10000, null, 'pms',
                  :now, :now
                )
                """
            ),
            {
                "rid": reservation_id,
                "org_id": org_id,
                "gid": guest_id,
                "prop_id": prop_id,
                "room_id": room_id,
                "in_at": now - timedelta(hours=2),
                "out_at": now + timedelta(hours=1),
                "now": now,
            },
        )
        await session.commit()

    yield {"org_id": org_id, "property_id": prop_id, "room_id": room_id, "reservation_id": reservation_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.front_desk_events where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.action_queue where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.reservations where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guests where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.rooms where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_front_desk_check_out_updates_reservation_and_clears_room(seeded_check_out) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_check_out["org_id"]
    reservation_id = seeded_check_out["reservation_id"]
    room_id = seeded_check_out["room_id"]

    async with _client_for_org(org_id=org_id) as client:
        resp = await client.post(f"/api/operations/front-desk/check-out/{reservation_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "checked_out"
    assert body["reservation_id"] == str(reservation_id)
    assert body["room_id"] == str(room_id)

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        res = (
            await session.execute(
                text("select status from ops.reservations where id = :id and org_id = :org"),
                {"id": str(reservation_id), "org": str(org_id)},
            )
        ).mappings().one()
        assert res["status"] == "checked_out"

        room = (
            await session.execute(
                text("select status, current_reservation_id from ops.rooms where id = :id and org_id = :org"),
                {"id": str(room_id), "org": str(org_id)},
            )
        ).mappings().one()
        assert room["status"] == "vacant_dirty"
        assert room["current_reservation_id"] is None

