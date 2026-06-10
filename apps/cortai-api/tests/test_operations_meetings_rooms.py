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
async def seeded_property_for_meetings_rooms() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="Meetings Org", slug=f"meetings-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status, room_count)
                values (:p, :org, 'Hotel Meetings', :slug, :now, :now, 'ACTIVE', 200)
                """
            ),
            {"p": prop_id, "org": org_id, "slug": f"hotel-meetings-{org_id}", "now": now},
        )
        await session.commit()

    yield {"org_id": org_id, "property_id": prop_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.meeting_rooms where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_meetings_rooms_crud(seeded_property_for_meetings_rooms) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_property_for_meetings_rooms["org_id"]
    prop_id = seeded_property_for_meetings_rooms["property_id"]
    async with _client_for_org(org_id=org_id) as client:
        created = await client.post(
            "/api/operations/meetings/rooms",
            json={"property_id": str(prop_id), "name": "Ballroom A", "capacity": 120, "equipment": ["projector", "mic"]},
        )
        assert created.status_code == 201
        room_id = created.json()["id"]

        listed = await client.get(f"/api/operations/meetings/rooms?property_id={prop_id}")
        assert listed.status_code == 200
        assert any(item["id"] == room_id for item in listed.json()["items"])

        patched = await client.patch(f"/api/operations/meetings/rooms/{room_id}", json={"capacity": 150})
        assert patched.status_code == 200
        assert patched.json()["capacity"] == 150

        deleted = await client.delete(f"/api/operations/meetings/rooms/{room_id}")
        assert deleted.status_code == 204


@pytest.mark.asyncio
async def test_meetings_rooms_mutation_writes_audit_log(seeded_property_for_meetings_rooms) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_property_for_meetings_rooms["org_id"]
    prop_id = seeded_property_for_meetings_rooms["property_id"]
    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("truncate table audit.change_log"))
        await session.commit()

    async with _client_for_org(org_id=org_id) as client:
        created = await client.post(
            "/api/operations/meetings/rooms",
            json={"property_id": str(prop_id), "name": "Audit Room", "capacity": 12, "equipment": []},
        )
    assert created.status_code == 201

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        row = (
            await session.execute(
                text(
                    """
                    select action, entity_type, after_json
                    from audit.change_log
                    where org_id = :org_id
                    order by ts desc
                    limit 1
                    """
                ),
                {"org_id": str(org_id)},
            )
        ).mappings().one()

    assert row["action"] == "post"
    assert row["entity_type"] == "operations"
    assert row["after_json"]["name"] == "Audit Room"


@pytest.mark.asyncio
async def test_meetings_rooms_404_when_property_missing(seeded_property_for_meetings_rooms) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_property_for_meetings_rooms["org_id"]
    missing = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/meetings/rooms?property_id={missing}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_meetings_rooms_patch_404_when_room_missing(seeded_property_for_meetings_rooms) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_property_for_meetings_rooms["org_id"]
    missing = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.patch(f"/api/operations/meetings/rooms/{missing}", json={"capacity": 10})
    assert resp.status_code == 404

