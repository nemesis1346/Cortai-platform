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
async def seeded_property_and_guest_for_spa() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()
    guest_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="Spa Org", slug=f"spa-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status, room_count)
                values (:p, :org, 'Hotel Spa', :slug, :now, :now, 'ACTIVE', 200)
                """
            ),
            {"p": prop_id, "org": org_id, "slug": f"hotel-spa-{org_id}", "now": now},
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
        await session.commit()

    yield {"org_id": org_id, "property_id": prop_id, "guest_id": guest_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.spa_appointments where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guests where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_spa_appointments_create_list_patch(seeded_property_and_guest_for_spa) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_property_and_guest_for_spa["org_id"]
    prop_id = seeded_property_and_guest_for_spa["property_id"]
    guest_id = seeded_property_and_guest_for_spa["guest_id"]
    starts = datetime.now(UTC) + timedelta(days=1)
    ends = starts + timedelta(minutes=50)

    async with _client_for_org(org_id=org_id) as client:
        created = await client.post(
            "/api/operations/spa/appointments",
            json={
                "property_id": str(prop_id),
                "guest_id": str(guest_id),
                "service": "Swedish Massage",
                "starts_at": starts.isoformat(),
                "ends_at": ends.isoformat(),
                "status": "booked",
            },
        )
        assert created.status_code == 201
        appt_id = created.json()["id"]

        listed = await client.get(f"/api/operations/spa/appointments?property_id={prop_id}&page=1&page_size=50")
        assert listed.status_code == 200
        body = listed.json()
        assert body["total"] >= 1

        patched = await client.patch(
            f"/api/operations/spa/appointments/{appt_id}",
            json={"status": "completed"},
        )
        assert patched.status_code == 200
        assert patched.json()["status"] == "completed"


@pytest.mark.asyncio
async def test_spa_appointments_404_when_property_missing(seeded_property_and_guest_for_spa) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_property_and_guest_for_spa["org_id"]
    missing = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/spa/appointments?property_id={missing}&page=1&page_size=10")
    assert resp.status_code == 404

