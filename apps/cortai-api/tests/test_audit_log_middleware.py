import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.auth.security import decode_token
from app.db import SessionLocal, get_session, set_current_org
from app.main import create_app
from app.models import Organization, User, UserRole, UserStatus


@pytest_asyncio.fixture
async def seeded_audit_env() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    now = datetime.now(UTC)

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="Audit Org", slug=f"audit-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        session.add(
            User(
                id=user_id,
                org_id=org_id,
                email=f"audit-admin-{org_id}@example.com",
                full_name="Audit Admin",
                role=UserRole.IT_ADMIN,
                status=UserStatus.ACTIVE,
                password_hash="hash",  # noqa: S106
                created_at=now,
                updated_at=now,
            )
        )
        await session.commit()

    yield {"org_id": org_id, "user_id": user_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        # audit.change_log is immutable (UPDATE/DELETE blocked by trigger). TRUNCATE is allowed.
        await session.execute(
            text("truncate table audit.change_log"),
        )
        await session.execute(text("delete from users where org_id = :org_id"), {"org_id": str(org_id)})
        await session.execute(text("delete from organizations where id = :org_id"), {"org_id": str(org_id)})
        await session.commit()


def _client(*, org_id: uuid.UUID, user_id: uuid.UUID) -> AsyncClient:
    app = create_app()

    async def override_session():  # type: ignore[no-untyped-def]
        async with SessionLocal() as session:
            await set_current_org(session, str(org_id))
            yield session

    app.dependency_overrides[get_session] = override_session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_admin_post_is_audited(seeded_audit_env) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_audit_env["org_id"]
    user_id = seeded_audit_env["user_id"]

    # Stub tenant auth: TenantContextMiddleware calls decode_token() for any non-empty token.
    def _fake_decode_token(_token: str):  # type: ignore[no-untyped-def]
        from app.auth.schemas import Principal

        return Principal(
            user_id=user_id, org_id=org_id, email="audit@example.com", role=UserRole.IT_ADMIN
        )

    # Patch the function at its import site.
    import app.middleware.tenant as tenant_mw

    tenant_mw.decode_token = _fake_decode_token  # type: ignore[assignment]

    async with _client(org_id=org_id, user_id=user_id) as client:
        resp = await client.post(
            "/api/admin/users",
            json={
                "email": f"new-{uuid.uuid4()}@example.com",
                "full_name": "New User",
                "role": "HOTEL_ADMIN",
                "status": "ACTIVE",
                "password": "very-secure-password",
            },
            headers={"user-agent": "pytest"},
            cookies={"cortai_access_token": "test-token"},
        )

    assert resp.status_code == 201

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        row = await session.execute(
            text(
                """
                select action, entity_type, org_id, user_id, ip, user_agent
                from audit.change_log
                where org_id = :org_id
                order by ts desc
                limit 1
                """
            ),
            {"org_id": str(org_id)},
        )
        m = row.mappings().one()

    assert m["action"] == "post"
    assert m["entity_type"] == "admin_user"
    assert m["org_id"] == org_id
    assert m["user_id"] == user_id
    assert m["user_agent"] == "pytest"


@pytest.mark.asyncio
async def test_admin_patch_device_captures_before_and_after(seeded_audit_env) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_audit_env["org_id"]
    user_id = seeded_audit_env["user_id"]
    device_pk = uuid.uuid4()
    now = datetime.now(UTC)

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
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
                "id": str(device_pk),
                "org_id": str(org_id),
                "device_id": f"edge-audit-{org_id}",
                "type": "edge_distributed",
                "capabilities": ["mqtt_subscribe"],
                "now": now,
            },
        )
        await session.commit()

    def _fake_decode_token(_token: str):  # type: ignore[no-untyped-def]
        from app.auth.schemas import Principal

        return Principal(
            user_id=user_id, org_id=org_id, email="audit@example.com", role=UserRole.IT_ADMIN
        )

    import app.middleware.tenant as tenant_mw

    tenant_mw.decode_token = _fake_decode_token  # type: ignore[assignment]

    async with _client(org_id=org_id, user_id=user_id) as client:
        resp = await client.patch(
            f"/api/admin/devices/{device_pk}",
            json={"capabilities": ["mqtt_subscribe", "tls_mtls"]},
            headers={"user-agent": "pytest"},
            cookies={"cortai_access_token": "test-token"},
        )
    assert resp.status_code == 200

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        row = await session.execute(
            text(
                """
                select action, entity_type, entity_id, before_json, after_json
                from audit.change_log
                where org_id = :org_id and entity_type = 'admin_device'
                order by ts desc
                limit 1
                """
            ),
            {"org_id": str(org_id)},
        )
        m = row.mappings().one()

    assert m["action"] == "patch"
    assert m["entity_id"] == str(device_pk)
    assert m["before_json"] is not None
    assert m["after_json"] is not None


@pytest.mark.asyncio
async def test_admin_delete_device_captures_before(seeded_audit_env) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_audit_env["org_id"]
    user_id = seeded_audit_env["user_id"]
    device_pk = uuid.uuid4()
    now = datetime.now(UTC)

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
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
                "id": str(device_pk),
                "org_id": str(org_id),
                "device_id": f"edge-audit-del-{org_id}",
                "type": "edge_distributed",
                "capabilities": ["mqtt_subscribe"],
                "now": now,
            },
        )
        await session.commit()

    def _fake_decode_token(_token: str):  # type: ignore[no-untyped-def]
        from app.auth.schemas import Principal

        return Principal(
            user_id=user_id, org_id=org_id, email="audit@example.com", role=UserRole.IT_ADMIN
        )

    import app.middleware.tenant as tenant_mw

    tenant_mw.decode_token = _fake_decode_token  # type: ignore[assignment]

    async with _client(org_id=org_id, user_id=user_id) as client:
        resp = await client.delete(
            f"/api/admin/devices/{device_pk}",
            headers={"user-agent": "pytest"},
            cookies={"cortai_access_token": "test-token"},
        )
    assert resp.status_code == 204

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        row = await session.execute(
            text(
                """
                select action, entity_type, entity_id, before_json, after_json
                from audit.change_log
                where org_id = :org_id and entity_type = 'admin_device'
                order by ts desc
                limit 1
                """
            ),
            {"org_id": str(org_id)},
        )
        m = row.mappings().one()

    assert m["action"] == "delete"
    assert m["entity_id"] == str(device_pk)
    assert m["before_json"] is not None
    # DELETE returns no JSON body.
    assert m["after_json"] is None

