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
async def seeded_property_guest_and_class_for_fitness_checkins() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()
    guest_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="Fitness Checkins Org", slug=f"fitness-checkins-{org_id}"))
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
        await session.execute(
            text(
                """
                insert into ops.guests (id, org_id, first_name, last_name, vip, language, phone_e164, email, preferences_json, created_at, updated_at)
                values (:g, :org, 'Ada', 'Lovelace', false, 'en', null, null, '{}'::jsonb, :now, :now)
                """
            ),
            {"g": guest_id, "org": org_id, "now": now},
        )
        starts = now + timedelta(days=1)
        ends = starts + timedelta(hours=1)
        class_row = (
            await session.execute(
                text(
                    """
                    insert into ops.fitness_classes (
                      id, org_id, property_id,
                      name, instructor_name, starts_at, ends_at, capacity, booked, location, description, status,
                      created_at, updated_at
                    )
                    values (
                      gen_random_uuid(), :org_id, :property_id,
                      'Yoga', 'Ava', :starts_at, :ends_at, 20, 0, null, null, 'scheduled',
                      :now, :now
                    )
                    returning id
                    """
                ),
                {"org_id": str(org_id), "property_id": str(prop_id), "starts_at": starts, "ends_at": ends, "now": now},
            )
        ).mappings().one()
        class_id = uuid.UUID(str(class_row["id"]))

        await session.commit()

    yield {"org_id": org_id, "property_id": prop_id, "guest_id": guest_id, "class_id": class_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.fitness_checkins where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.fitness_classes where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guests where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_fitness_checkins_create_and_list(seeded_property_guest_and_class_for_fitness_checkins) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_property_guest_and_class_for_fitness_checkins["org_id"]
    prop_id = seeded_property_guest_and_class_for_fitness_checkins["property_id"]
    guest_id = seeded_property_guest_and_class_for_fitness_checkins["guest_id"]
    class_id = seeded_property_guest_and_class_for_fitness_checkins["class_id"]

    async with _client_for_org(org_id=org_id) as client:
        created = await client.post(
            "/api/operations/fitness/checkins",
            json={
                "property_id": str(prop_id),
                "guest_id": str(guest_id),
                "class_id": str(class_id),
                "source": "manual",
                "notes": "Front desk",
            },
        )
        assert created.status_code == 201
        body = created.json()
        assert body["guest_id"] == str(guest_id)
        assert body["property_id"] == str(prop_id)

        listed = await client.get(f"/api/operations/fitness/checkins?property_id={prop_id}")
        assert listed.status_code == 200
        assert isinstance(listed.json()["items"], list)
        assert len(listed.json()["items"]) >= 1

        filtered = await client.get(f"/api/operations/fitness/checkins?property_id={prop_id}&guest_id={guest_id}")
        assert filtered.status_code == 200
        assert all(item["guest_id"] == str(guest_id) for item in filtered.json()["items"])


@pytest.mark.asyncio
async def test_fitness_checkins_404_when_property_missing(seeded_property_guest_and_class_for_fitness_checkins) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_property_guest_and_class_for_fitness_checkins["org_id"]
    missing = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/fitness/checkins?property_id={missing}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_fitness_checkins_404_when_guest_missing(seeded_property_guest_and_class_for_fitness_checkins) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_property_guest_and_class_for_fitness_checkins["org_id"]
    prop_id = seeded_property_guest_and_class_for_fitness_checkins["property_id"]
    missing_guest = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        created = await client.post(
            "/api/operations/fitness/checkins",
            json={"property_id": str(prop_id), "guest_id": str(missing_guest)},
        )
    assert created.status_code == 404

