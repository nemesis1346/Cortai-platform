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


@pytest_asyncio.fixture
async def seeded_room_patch() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)

    prop_id = uuid.uuid4()
    room_id = uuid.uuid4()
    attendant_a = uuid.uuid4()
    attendant_b = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="Rooms Patch Org", slug=f"rooms-patch-{org_id}"))
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
        session.add_all(
            [
                User(
                    id=attendant_a,
                    org_id=org_id,
                    email=f"att-a-{org_id}@example.com",
                    full_name="Att A",
                    role=UserRole.STAFF,
                    status=UserStatus.ACTIVE,
                    password_hash="hash",  # noqa: S106
                    created_at=now,
                    updated_at=now,
                ),
                User(
                    id=attendant_b,
                    org_id=org_id,
                    email=f"att-b-{org_id}@example.com",
                    full_name="Att B",
                    role=UserRole.STAFF,
                    status=UserStatus.ACTIVE,
                    password_hash="hash",  # noqa: S106
                    created_at=now,
                    updated_at=now,
                ),
            ]
        )
        await session.commit()

    yield {"org_id": org_id, "property_id": prop_id, "room_id": room_id, "att_a": attendant_a, "att_b": attendant_b}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.housekeeping_assignments where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.rooms where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from users where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_room_patch_rejects_empty_payload(seeded_room_patch) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_room_patch["org_id"]
    room_id = seeded_room_patch["room_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.patch(f"/api/operations/rooms/{room_id}", json={})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_room_patch_sets_out_of_order_and_inspected(seeded_room_patch) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_room_patch["org_id"]
    room_id = seeded_room_patch["room_id"]
    async with _client_for_org(org_id=org_id) as client:
        ooo = await client.patch(f"/api/operations/rooms/{room_id}", json={"status": "out_of_order"})
        inspected = await client.patch(f"/api/operations/rooms/{room_id}", json={"status": "inspected"})
    assert ooo.status_code == 200
    assert ooo.json()["status"] == "out_of_order"
    assert inspected.status_code == 200
    assert inspected.json()["status"] == "inspected"


@pytest.mark.asyncio
async def test_room_patch_reassigns_attendant_creating_assignment(seeded_room_patch) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_room_patch["org_id"]
    room_id = seeded_room_patch["room_id"]
    att_a = seeded_room_patch["att_a"]
    att_b = seeded_room_patch["att_b"]

    async with _client_for_org(org_id=org_id) as client:
        first = await client.patch(f"/api/operations/rooms/{room_id}", json={"attendant_user_id": str(att_a)})
        second = await client.patch(f"/api/operations/rooms/{room_id}", json={"attendant_user_id": str(att_b)})

    assert first.status_code == 200
    assert second.status_code == 200

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        row = (
            await session.execute(
                text(
                    """
                    select attendant_user_id
                    from ops.housekeeping_assignments
                    where org_id = :org_id and room_id = :room_id
                    order by created_at desc
                    limit 1
                    """
                ),
                {"org_id": str(org_id), "room_id": str(room_id)},
            )
        ).mappings().one()
    assert str(row["attendant_user_id"]) == str(att_b)


@pytest.mark.asyncio
async def test_room_patch_404_when_missing(seeded_room_patch) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_room_patch["org_id"]
    missing = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.patch(f"/api/operations/rooms/{missing}", json={"status": "out_of_order"})
    assert resp.status_code == 404

