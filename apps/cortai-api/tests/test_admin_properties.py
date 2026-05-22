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


@pytest_asyncio.fixture
async def seeded_admin_properties() -> dict[str, uuid.UUID | str]:
    org_a = uuid.uuid4()
    org_b = uuid.uuid4()
    now = datetime.now(UTC)

    prop_a_id = uuid.uuid4()
    prop_b_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add_all(
            [
                Organization(id=org_a, name="Admin Properties Org A", slug=f"admin-props-a-{org_a}"),
                Organization(id=org_b, name="Admin Properties Org B", slug=f"admin-props-b-{org_b}"),
            ]
        )
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_a))
        await session.execute(
            text(
                """
                insert into properties (
                  id, org_id, name, slug, marsha_property_id, address, room_count, status, created_at, updated_at
                )
                values (
                  :id, :org_id, :name, :slug, null, null, null, 'ACTIVE', :now, :now
                )
                """
            ),
            {"id": prop_a_id, "org_id": org_a, "name": "Hotel A", "slug": "hotel-a", "now": now},
        )
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_b))
        await session.execute(
            text(
                """
                insert into properties (
                  id, org_id, name, slug, marsha_property_id, address, room_count, status, created_at, updated_at
                )
                values (
                  :id, :org_id, :name, :slug, null, null, null, 'ACTIVE', :now, :now
                )
                """
            ),
            {"id": prop_b_id, "org_id": org_b, "name": "Hotel B", "slug": "hotel-b", "now": now},
        )
        await session.commit()

    yield {"org_a": org_a, "org_b": org_b, "prop_a_id": prop_a_id, "prop_b_id": prop_b_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_a))
        await session.execute(text("delete from properties where org_id = :org_id"), {"org_id": org_a})
        await set_current_org(session, str(org_b))
        await session.execute(text("delete from properties where org_id = :org_id"), {"org_id": org_b})
        await session.execute(
            text("delete from organizations where id in (:org_a, :org_b)"),
            {"org_a": org_a, "org_b": org_b},
        )
        await session.commit()


def _client_for_org(*, org_id: uuid.UUID, role: UserRole) -> AsyncClient:
    app = create_app()

    async def override_principal() -> Principal:
        return Principal(user_id=uuid.uuid4(), org_id=org_id, email="admin@example.com", role=role)

    async def override_session():  # type: ignore[no-untyped-def]
        async with SessionLocal() as session:
            await set_current_org(session, str(org_id))
            yield session

    app.dependency_overrides[get_principal] = override_principal
    app.dependency_overrides[get_session] = override_session

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_list_properties_is_scoped_to_principal_org(seeded_admin_properties) -> None:  # type: ignore[no-untyped-def]
    org_a = seeded_admin_properties["org_a"]
    async with _client_for_org(org_id=org_a, role=UserRole.IT_ADMIN) as client:
        response = await client.get("/api/admin/properties")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert all(item["org_id"] == str(org_a) for item in body["items"])


@pytest.mark.asyncio
async def test_non_admin_is_forbidden(seeded_admin_properties) -> None:  # type: ignore[no-untyped-def]
    org_a = seeded_admin_properties["org_a"]
    async with _client_for_org(org_id=org_a, role=UserRole.STAFF) as client:
        response = await client.get("/api/admin/properties")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_get_property_returns_404_for_other_org(seeded_admin_properties) -> None:  # type: ignore[no-untyped-def]
    org_a = seeded_admin_properties["org_a"]
    prop_b_id = seeded_admin_properties["prop_b_id"]
    async with _client_for_org(org_id=org_a, role=UserRole.IT_ADMIN) as client:
        response = await client.get(f"/api/admin/properties/{prop_b_id}")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_create_property_sets_org_and_generates_slug(seeded_admin_properties) -> None:  # type: ignore[no-untyped-def]
    org_a = seeded_admin_properties["org_a"]
    async with _client_for_org(org_id=org_a, role=UserRole.IT_ADMIN) as client:
        response = await client.post(
            "/api/admin/properties",
            json={"name": "TownePlace Suites Vaughan", "status": "ACTIVE", "room_count": 122},
        )

    assert response.status_code == 201
    body = response.json()
    assert body["org_id"] == str(org_a)
    assert body["slug"]
    assert body["room_count"] == 122


@pytest.mark.asyncio
async def test_update_property_patches_fields(seeded_admin_properties) -> None:  # type: ignore[no-untyped-def]
    org_a = seeded_admin_properties["org_a"]
    prop_a_id = seeded_admin_properties["prop_a_id"]
    async with _client_for_org(org_id=org_a, role=UserRole.IT_ADMIN) as client:
        response = await client.patch(
            f"/api/admin/properties/{prop_a_id}",
            json={"status": "INACTIVE", "marsha_property_id": "TPSV123"},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "INACTIVE"
    assert body["marsha_property_id"] == "TPSV123"


@pytest.mark.asyncio
async def test_delete_property_removes_row(seeded_admin_properties) -> None:  # type: ignore[no-untyped-def]
    org_a = seeded_admin_properties["org_a"]
    prop_a_id = seeded_admin_properties["prop_a_id"]
    async with _client_for_org(org_id=org_a, role=UserRole.IT_ADMIN) as client:
        response = await client.delete(f"/api/admin/properties/{prop_a_id}")
    assert response.status_code == 204

