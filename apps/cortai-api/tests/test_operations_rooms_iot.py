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
async def seeded_room_for_iot() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()
    room_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="Rooms IoT Org", slug=f"rooms-iot-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status, room_count)
                values (:p, :org, 'Hotel A', 'hotel-a', :now, :now, 'ACTIVE', 200)
                """
            ),
            {"p": prop_id, "org": org_id, "now": now},
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
        await session.commit()

    yield {"org_id": org_id, "room_id": room_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.rooms where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_rooms_iot_returns_fixture_payload(seeded_room_for_iot) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_room_for_iot["org_id"]
    room_id = seeded_room_for_iot["room_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/rooms/{room_id}/iot")
    assert resp.status_code == 200
    body = resp.json()
    assert "hvac" in body
    assert "sensors" in body


@pytest.mark.asyncio
async def test_rooms_iot_404_when_room_missing(seeded_room_for_iot) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_room_for_iot["org_id"]
    missing = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/rooms/{missing}/iot")
    assert resp.status_code == 404

