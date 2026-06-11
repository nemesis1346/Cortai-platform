import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

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
async def seeded_property_room_and_order() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()
    room_id = uuid.uuid4()
    order_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="FB RS Org", slug=f"fb-rs-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status, room_count)
                values (:p, :org, 'Hotel FB RS', :slug, :now, :now, 'ACTIVE', 200)
                """
            ),
            {"p": prop_id, "org": org_id, "slug": f"hotel-fb-rs-{org_id}", "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.rooms (id, org_id, property_id, room_number, floor, type, status, vip, created_at, updated_at)
                values (:r, :org, :p, '101', 1, 'king', 'vacant_clean', false, :now, :now)
                """
            ),
            {"r": room_id, "org": org_id, "p": prop_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.room_service_orders (id, org_id, room_id, guest_id, items_json, status, created_at, updated_at)
                values (:o, :org, :r, null, :items_json, 'received', :now, :now)
                """
            ).bindparams(sa.bindparam("items_json", type_=postgresql.JSONB)),
            {"o": order_id, "org": org_id, "r": room_id, "items_json": {"items": [{"sku": "coffee", "qty": 2}]}, "now": now},
        )
        await session.commit()

    yield {"org_id": org_id, "property_id": prop_id, "room_id": room_id, "order_id": order_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.room_service_orders where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.rooms where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_room_service_list_property_scoped(seeded_property_room_and_order) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_property_room_and_order["org_id"]
    prop_id = seeded_property_room_and_order["property_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/fb/room-service?property_id={prop_id}&limit=50")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body["items"], list)
    assert len(body["items"]) >= 1
    assert body["items"][0]["status"] in {"received", "preparing", "en_route", "delivered", "cancelled"}


@pytest.mark.asyncio
async def test_room_service_create_and_patch(seeded_property_room_and_order) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_property_room_and_order["org_id"]
    prop_id = seeded_property_room_and_order["property_id"]
    room_id = seeded_property_room_and_order["room_id"]

    async with _client_for_org(org_id=org_id) as client:
        created = await client.post(
            "/api/operations/fb/room-service",
            json={
                "property_id": str(prop_id),
                "room_id": str(room_id),
                "items_json": {"items": [{"sku": "sandwich", "qty": 1}]},
            },
        )
        assert created.status_code == 201
        oid = created.json()["id"]

        patched = await client.patch(
            f"/api/operations/fb/room-service/{oid}",
            json={"status": "preparing"},
        )
        assert patched.status_code == 200
        assert patched.json()["status"] == "preparing"

