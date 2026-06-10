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
async def seeded_property_for_fitness_classes() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="Fitness Classes Org", slug=f"fitness-classes-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status, room_count)
                values (:p, :org, 'Hotel Fitness', :slug, :now, :now, 'ACTIVE', 200)
                """
            ),
            {"p": prop_id, "org": org_id, "slug": f"hotel-fitness-{org_id}", "now": now},
        )
        await session.commit()

    yield {"org_id": org_id, "property_id": prop_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.fitness_classes where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_fitness_classes_create_list_and_patch(seeded_property_for_fitness_classes) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_property_for_fitness_classes["org_id"]
    prop_id = seeded_property_for_fitness_classes["property_id"]
    starts = datetime.now(UTC) + timedelta(days=1)
    ends = starts + timedelta(hours=1)

    async with _client_for_org(org_id=org_id) as client:
        created = await client.post(
            "/api/operations/fitness/classes",
            json={
                "property_id": str(prop_id),
                "name": "Yoga Flow",
                "instructor_name": "Ava",
                "starts_at": starts.isoformat(),
                "ends_at": ends.isoformat(),
                "capacity": 20,
                "booked": 3,
                "location": "Studio A",
                "description": "Beginner friendly",
                "status": "scheduled",
            },
        )
        assert created.status_code == 201
        class_id = created.json()["id"]

        listed = await client.get(f"/api/operations/fitness/classes?property_id={prop_id}")
        assert listed.status_code == 200
        body = listed.json()
        assert isinstance(body["items"], list)
        assert any(item["id"] == class_id for item in body["items"])

        patched = await client.patch(
            f"/api/operations/fitness/classes/{class_id}",
            json={"booked": 5, "status": "completed"},
        )
        assert patched.status_code == 200
        patched_body = patched.json()
        assert patched_body["booked"] == 5
        assert patched_body["status"] == "completed"


@pytest.mark.asyncio
async def test_fitness_classes_404_when_property_missing(seeded_property_for_fitness_classes) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_property_for_fitness_classes["org_id"]
    missing = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/fitness/classes?property_id={missing}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_fitness_classes_patch_404_when_class_missing(seeded_property_for_fitness_classes) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_property_for_fitness_classes["org_id"]
    missing = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.patch(f"/api/operations/fitness/classes/{missing}", json={"status": "cancelled"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_fitness_classes_rejects_invalid_times(seeded_property_for_fitness_classes) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_property_for_fitness_classes["org_id"]
    prop_id = seeded_property_for_fitness_classes["property_id"]
    starts = datetime.now(UTC) + timedelta(days=1)
    ends = starts - timedelta(minutes=5)

    async with _client_for_org(org_id=org_id) as client:
        created = await client.post(
            "/api/operations/fitness/classes",
            json={
                "property_id": str(prop_id),
                "name": "Spin",
                "starts_at": starts.isoformat(),
                "ends_at": ends.isoformat(),
                "capacity": 10,
                "booked": 0,
            },
        )
    assert created.status_code == 400

