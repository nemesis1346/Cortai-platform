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
async def seeded_rooms() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    other_org_id = uuid.uuid4()
    now = datetime.now(UTC)

    prop_a = uuid.uuid4()
    prop_b = uuid.uuid4()
    other_prop = uuid.uuid4()

    room_101 = uuid.uuid4()
    room_201 = uuid.uuid4()
    room_ooo = uuid.uuid4()
    other_room = uuid.uuid4()

    async with SessionLocal() as session:
        session.add_all(
            [
                Organization(id=org_id, name="Rooms Org", slug=f"rooms-{org_id}"),
                Organization(id=other_org_id, name="Rooms Other Org", slug=f"rooms-{other_org_id}"),
            ]
        )
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status, room_count)
                values
                  (:p1, :org, 'Hotel A', 'hotel-a', :now, :now, 'ACTIVE', 200),
                  (:p2, :org, 'Hotel B', 'hotel-b', :now, :now, 'ACTIVE', 50)
                """
            ),
            {"p1": prop_a, "p2": prop_b, "org": org_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.rooms (id, org_id, property_id, room_number, floor, type, status, vip, created_at, updated_at, last_service_at)
                values
                  (:r101, :org, :p1, '101', 1, 'king', 'vacant_clean', false, :now, :now, :now),
                  (:r201, :org, :p1, '201', 2, 'queen', 'vacant_dirty', true, :now, :now, null),
                  (:rooo, :org, :p2, '001', 0, 'storage', 'out_of_order', false, :now, :now, null)
                """
            ),
            {"r101": room_101, "r201": room_201, "rooo": room_ooo, "org": org_id, "p1": prop_a, "p2": prop_b, "now": now},
        )
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(other_org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status, room_count)
                values (:p, :org, 'Other Hotel', 'other-hotel', :now, :now, 'ACTIVE', 10)
                """
            ),
            {"p": other_prop, "org": other_org_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.rooms (id, org_id, property_id, room_number, floor, type, status, vip, created_at, updated_at)
                values (:r, :org, :p, '999', 9, 'king', 'vacant_clean', false, :now, :now)
                """
            ),
            {"r": other_room, "org": other_org_id, "p": other_prop, "now": now},
        )
        await session.commit()

    yield {
        "org_id": org_id,
        "other_org_id": other_org_id,
        "prop_a": prop_a,
        "prop_b": prop_b,
    }

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.rooms where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})

        await set_current_org(session, str(other_org_id))
        await session.execute(text("delete from ops.rooms where org_id = :org"), {"org": other_org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": other_org_id})

        await session.execute(
            text("delete from organizations where id in (:a, :b)"),
            {"a": org_id, "b": other_org_id},
        )
        await session.commit()


@pytest.mark.asyncio
async def test_rooms_list_is_scoped_to_org(seeded_rooms) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_rooms["org_id"]
    prop_a = seeded_rooms["prop_a"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/rooms?property_id={prop_a}")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 2
    assert all(item["org_id"] == str(org_id) for item in body["items"])


@pytest.mark.asyncio
async def test_rooms_list_filters_by_property_floor_status_type_and_search(seeded_rooms) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_rooms["org_id"]
    prop_a = seeded_rooms["prop_a"]
    prop_b = seeded_rooms["prop_b"]

    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/rooms?property_id={prop_a}&floor=2")
        assert resp.status_code == 200
        assert [r["room_number"] for r in resp.json()["items"]] == ["201"]

        resp2 = await client.get(f"/api/operations/rooms?property_id={prop_b}&status=out_of_order")
        assert resp2.status_code == 200
        assert len(resp2.json()["items"]) == 1
        assert resp2.json()["items"][0]["status"] == "out_of_order"

        resp3 = await client.get(f"/api/operations/rooms?property_id={prop_a}&type=king")
        assert resp3.status_code == 200
        assert [r["room_number"] for r in resp3.json()["items"]] == ["101"]

        resp4 = await client.get(f"/api/operations/rooms?property_id={prop_a}&search=0")
        assert resp4.status_code == 200
        nums = {r["room_number"] for r in resp4.json()["items"]}
        assert nums == {"101", "201"}


@pytest.mark.asyncio
async def test_rooms_list_requires_property_id(seeded_rooms) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_rooms["org_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get("/api/operations/rooms")
    assert resp.status_code in {400, 422}

