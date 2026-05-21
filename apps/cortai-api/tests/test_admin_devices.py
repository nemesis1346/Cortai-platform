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
async def seeded_admin_devices() -> dict[str, uuid.UUID | str]:
    org_a = uuid.uuid4()
    org_b = uuid.uuid4()
    now = datetime.now(UTC)

    device_a_id = uuid.uuid4()
    device_b_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add_all(
            [
                Organization(id=org_a, name="Admin Devices Org A", slug=f"admin-devices-a-{org_a}"),
                Organization(id=org_b, name="Admin Devices Org B", slug=f"admin-devices-b-{org_b}"),
            ]
        )
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_a))
        await session.execute(
            text(
                """
                insert into platform.devices (
                  id, org_id, property_id, device_id, type, capabilities, cert_fingerprint,
                  logical_bindings, created_at, updated_at
                )
                values (
                  :id, :org_id, null, :device_id, :type, :capabilities, null,
                  '{}'::jsonb, :now, :now
                )
                """
            ),
            {
                "id": str(device_a_id),
                "org_id": str(org_a),
                "device_id": f"edge-a-{org_a}",
                "type": "edge_distributed",
                "capabilities": ["mqtt_subscribe", "tls_mtls"],
                "now": now,
            },
        )
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_b))
        await session.execute(
            text(
                """
                insert into platform.devices (
                  id, org_id, property_id, device_id, type, capabilities, cert_fingerprint,
                  logical_bindings, created_at, updated_at
                )
                values (
                  :id, :org_id, null, :device_id, :type, :capabilities, null,
                  '{}'::jsonb, :now, :now
                )
                """
            ),
            {
                "id": str(device_b_id),
                "org_id": str(org_b),
                "device_id": f"edge-b-{org_b}",
                "type": "edge_distributed",
                "capabilities": ["mqtt_subscribe"],
                "now": now,
            },
        )
        await session.commit()

    yield {"org_a": org_a, "org_b": org_b, "device_a_id": device_a_id, "device_b_id": device_b_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_a))
        await session.execute(text("delete from platform.devices where org_id = :org_id"), {"org_id": str(org_a)})
        await set_current_org(session, str(org_b))
        await session.execute(text("delete from platform.devices where org_id = :org_id"), {"org_id": str(org_b)})
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
async def test_list_devices_is_scoped_to_principal_org(seeded_admin_devices) -> None:  # type: ignore[no-untyped-def]
    org_a = seeded_admin_devices["org_a"]
    async with _client_for_org(org_id=org_a, role=UserRole.IT_ADMIN) as client:
        response = await client.get("/api/admin/devices")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert all(item["org_id"] == str(org_a) for item in body["items"])


@pytest.mark.asyncio
async def test_non_admin_is_forbidden(seeded_admin_devices) -> None:  # type: ignore[no-untyped-def]
    org_a = seeded_admin_devices["org_a"]
    async with _client_for_org(org_id=org_a, role=UserRole.STAFF) as client:
        response = await client.get("/api/admin/devices")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_public_devices_list_is_scoped_to_principal_org(seeded_admin_devices) -> None:  # type: ignore[no-untyped-def]
    org_a = seeded_admin_devices["org_a"]
    async with _client_for_org(org_id=org_a, role=UserRole.STAFF) as client:
        response = await client.get("/api/devices")

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["device_id"].startswith("edge-a-")
    assert "cert_fingerprint" not in body[0]
    assert "org_id" not in body[0]

