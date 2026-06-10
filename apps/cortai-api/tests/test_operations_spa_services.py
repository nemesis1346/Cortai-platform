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
async def seeded_property_for_spa_services() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="Spa Services Org", slug=f"spa-svc-{org_id}"))
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
        await session.commit()

    yield {"org_id": org_id, "property_id": prop_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.spa_services where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_spa_services_create_and_list(seeded_property_for_spa_services) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_property_for_spa_services["org_id"]
    prop_id = seeded_property_for_spa_services["property_id"]

    async with _client_for_org(org_id=org_id) as client:
        created = await client.post(
            "/api/operations/spa/services",
            json={
                "property_id": str(prop_id),
                "name": "Deep Tissue Massage",
                "description": "60 minutes",
                "duration_minutes": 60,
                "price_cents": 18000,
                "available": True,
            },
        )
        assert created.status_code == 201

        listed = await client.get(f"/api/operations/spa/services?property_id={prop_id}")
        assert listed.status_code == 200
        body = listed.json()
        assert isinstance(body["items"], list)
        assert len(body["items"]) >= 1


@pytest.mark.asyncio
async def test_spa_services_404_when_property_missing(seeded_property_for_spa_services) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_property_for_spa_services["org_id"]
    missing = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/spa/services?property_id={missing}")
    assert resp.status_code == 404

