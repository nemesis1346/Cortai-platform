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
async def seeded_walk_in() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()
    room_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="FD WalkIn Org", slug=f"fd-walkin-{org_id}"))
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
                insert into ops.rooms (id, org_id, property_id, room_number, floor, type, status, vip, created_at, updated_at)
                values (:room_id, :org_id, :prop_id, '101', 1, 'king', 'vacant_clean', false, :now, :now)
                """
            ),
            {"room_id": room_id, "org_id": org_id, "prop_id": prop_id, "now": now},
        )
        await session.commit()

    yield {"org_id": org_id, "property_id": prop_id, "room_id": room_id}

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
async def test_front_desk_walk_in_creates_guest_reservation_and_occupies_room(seeded_walk_in) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_walk_in["org_id"]
    prop_id = seeded_walk_in["property_id"]
    room_id = seeded_walk_in["room_id"]

    async with _client_for_org(org_id=org_id) as client:
        resp = await client.post(
            "/api/operations/front-desk/walk-in",
            json={
                "property_id": str(prop_id),
                "room_id": str(room_id),
                "guest": {"first_name": "Walk", "last_name": "In", "vip": False, "language": "en"},
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "checked_in"
    assert body["room_id"] == str(room_id)

    reservation_id = uuid.UUID(body["reservation_id"])
    guest_id = uuid.UUID(body["guest_id"])

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))

        res = (
            await session.execute(
                text("select status, room_id, guest_id, property_id from ops.reservations where id = :id and org_id = :org"),
                {"id": str(reservation_id), "org": str(org_id)},
            )
        ).mappings().one()
        assert res["status"] == "checked_in"
        assert str(res["room_id"]) == str(room_id)
        assert str(res["guest_id"]) == str(guest_id)
        assert str(res["property_id"]) == str(prop_id)

        room = (
            await session.execute(
                text("select status, current_reservation_id from ops.rooms where id = :id and org_id = :org"),
                {"id": str(room_id), "org": str(org_id)},
            )
        ).mappings().one()
        assert room["status"] == "occupied"
        assert str(room["current_reservation_id"]) == str(reservation_id)

        aq = (
            await session.execute(
                text(
                    """
                    select type, source, status
                    from ops.action_queue
                    where org_id = :org and room_id = :room_id
                    order by created_at desc
                    limit 1
                    """
                ),
                {"org": str(org_id), "room_id": str(room_id)},
            )
        ).mappings().one()
        assert aq["type"] == "request"
        assert aq["source"] == "front_desk"
        assert aq["status"] == "pending"

