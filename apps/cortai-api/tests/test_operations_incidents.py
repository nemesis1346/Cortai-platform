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
from app.models import Organization, User, UserRole, UserStatus
import app.storage.s3 as s3mod


@pytest_asyncio.fixture
async def seeded_incidents() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    other_org_id = uuid.uuid4()
    now = datetime.now(UTC)

    prop_a = uuid.uuid4()
    prop_b = uuid.uuid4()
    other_prop = uuid.uuid4()

    incident_a = uuid.uuid4()
    incident_b = uuid.uuid4()
    other_incident = uuid.uuid4()
    assignee_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add_all(
            [
                Organization(id=org_id, name="Incidents Org", slug=f"incidents-{org_id}"),
                Organization(id=other_org_id, name="Incidents Other Org", slug=f"incidents-{other_org_id}"),
            ]
        )
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        session.add(
            User(
                id=assignee_id,
                org_id=org_id,
                email=f"assignee-{org_id}@example.com",
                full_name="Assignee",
                role=UserRole.STAFF,
                status=UserStatus.ACTIVE,
                password_hash="hash",  # noqa: S106
                created_at=now,
                updated_at=now,
            )
        )
        # properties table exists and is RLS protected; create two properties.
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status)
                values
                  (:p1, :org, 'Hotel A', 'hotel-a', :now, :now, 'ACTIVE'),
                  (:p2, :org, 'Hotel B', 'hotel-b', :now, :now, 'ACTIVE')
                """
            ),
            {"p1": prop_a, "p2": prop_b, "org": org_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into operations.incidents (
                  id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at
                )
                values
                  (:i1, :org, :p1, 'HIGH', 'OPEN', 'Camera offline', 'Edge cam down', null, :now, null),
                  (:i2, :org, :p2, 'LOW', 'RESOLVED', 'Door ajar', null, null, :yesterday, :now)
                """
            ),
            {
                "i1": incident_a,
                "i2": incident_b,
                "org": org_id,
                "p1": prop_a,
                "p2": prop_b,
                "now": now,
                "yesterday": now - timedelta(days=1),
            },
        )
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(other_org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status)
                values (:p1, :org, 'Other Hotel', 'other-hotel', :now, :now, 'ACTIVE')
                """
            ),
            {"p1": other_prop, "org": other_org_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into operations.incidents (
                  id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at
                )
                values (:i1, :org, :p1, 'CRITICAL', 'OPEN', 'Other org', null, null, :now, null)
                """
            ),
            {"i1": other_incident, "org": other_org_id, "p1": other_prop, "now": now},
        )
        await session.commit()

    yield {
        "org_id": org_id,
        "other_org_id": other_org_id,
        "prop_a": prop_a,
        "prop_b": prop_b,
        "incident_a": incident_a,
        "incident_b": incident_b,
        "other_incident": other_incident,
        "assignee_id": assignee_id,
    }

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text("delete from operations.incidents where org_id = :org_id"), {"org_id": org_id}
        )
        await session.execute(text("delete from users where org_id = :org_id"), {"org_id": org_id})
        await session.execute(text("delete from properties where org_id = :org_id"), {"org_id": org_id})

        await set_current_org(session, str(other_org_id))
        await session.execute(
            text("delete from operations.incidents where org_id = :org_id"), {"org_id": other_org_id}
        )
        await session.execute(
            text("delete from properties where org_id = :org_id"), {"org_id": other_org_id}
        )

        await session.execute(
            text("delete from organizations where id in (:a, :b)"),
            {"a": org_id, "b": other_org_id},
        )
        await session.commit()


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


def _client_for_org_with_audit(*, org_id: uuid.UUID, user_id: uuid.UUID) -> AsyncClient:
    """
    Use cookie-based auth path so TenantContextMiddleware sets request.state.principal,
    which is required for AuditLogMiddleware.
    """
    app = create_app()

    async def override_session():  # type: ignore[no-untyped-def]
        async with SessionLocal() as session:
            await set_current_org(session, str(org_id))
            yield session

    app.dependency_overrides[get_session] = override_session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_list_incidents_is_scoped_to_org(seeded_incidents) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_incidents["org_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get("/api/operations/incidents?page=1&page_size=50")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert all(item["org_id"] == str(org_id) for item in body["items"])


@pytest.mark.asyncio
async def test_filter_by_property_and_severity(seeded_incidents) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_incidents["org_id"]
    prop_a = seeded_incidents["prop_a"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(
            f"/api/operations/incidents?property_id={prop_a}&severity=HIGH&page=1&page_size=20"
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["property_id"] == str(prop_a)
    assert body["items"][0]["severity"] == "HIGH"


@pytest.mark.asyncio
async def test_create_incident_and_export_csv(seeded_incidents) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_incidents["org_id"]
    prop_b = seeded_incidents["prop_b"]
    async with _client_for_org(org_id=org_id) as client:
        create = await client.post(
            "/api/operations/incidents",
            json={
                "property_id": str(prop_b),
                "severity": "MEDIUM",
                "status": "OPEN",
                "title": "Test incident",
                "description": "hello",
                "assigned_to": None,
            },
        )
        assert create.status_code == 201
        created_id = create.json()["id"]

        csv_resp = await client.get("/api/operations/incidents/export.csv")

    assert csv_resp.status_code == 200
    assert csv_resp.headers["content-type"].startswith("text/csv")
    csv_text = csv_resp.text
    assert "id,org_id,property_id,severity,status,title,description,assigned_to,created_at,resolved_at" in csv_text
    assert created_id in csv_text


@pytest.mark.asyncio
async def test_list_incidents_ignores_invalid_date_filters(seeded_incidents) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_incidents["org_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(
            "/api/operations/incidents?start=not-a-date&end=also-not-a-date&page=1&page_size=50"
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2


@pytest.mark.asyncio
async def test_get_incident_404_when_missing(seeded_incidents) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_incidents["org_id"]
    missing_id = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/incidents/{missing_id}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_patch_resolved_sets_resolved_at_when_omitted(seeded_incidents) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_incidents["org_id"]
    incident_id = seeded_incidents["incident_a"]
    async with _client_for_org(org_id=org_id) as client:
        patched = await client.patch(
            f"/api/operations/incidents/{incident_id}",
            json={"status": "RESOLVED"},
        )
        assert patched.status_code == 200
        body = patched.json()
        assert body["status"] == "RESOLVED"
        assert body["resolved_at"] is not None


@pytest.mark.asyncio
async def test_patch_incident_rejects_empty_payload(seeded_incidents) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_incidents["org_id"]
    incident_id = seeded_incidents["incident_a"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.patch(f"/api/operations/incidents/{incident_id}", json={})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_delete_incident_404_when_missing(seeded_incidents) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_incidents["org_id"]
    missing_id = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.delete(f"/api/operations/incidents/{missing_id}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_incidents_search_filters_results(seeded_incidents) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_incidents["org_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get("/api/operations/incidents?search=camera&page=1&page_size=50")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["title"].lower().startswith("camera")


@pytest.mark.asyncio
async def test_patch_assign_endpoint_updates_and_notifies_and_audits(seeded_incidents) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_incidents["org_id"]
    incident_id = seeded_incidents["incident_a"]
    assignee_id = seeded_incidents["assignee_id"]

    # Ensure audit table is clean for this org.
    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("truncate table audit.change_log"))
        await session.commit()

    # Stub tenant auth (cookie token) so middleware sets request.state.principal.
    def _fake_decode_token(_token: str):  # type: ignore[no-untyped-def]
        from app.auth.schemas import Principal

        return Principal(user_id=assignee_id, org_id=org_id, email="user@example.com", role=UserRole.STAFF)

    import app.middleware.tenant as tenant_mw

    tenant_mw.decode_token = _fake_decode_token  # type: ignore[assignment]

    async with _client_for_org_with_audit(org_id=org_id, user_id=assignee_id) as client:
        resp = await client.patch(
            f"/api/operations/incidents/{incident_id}/assign",
            json={"assigned_to": str(assignee_id)},
            cookies={"cortai_access_token": "test-token"},
            headers={"user-agent": "pytest"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["assigned_to"] == str(assignee_id)

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        row = await session.execute(
            text(
                """
                select action, entity_type, entity_id, before_json, after_json
                from audit.change_log
                where org_id = :org_id and entity_type = 'operations_incident'
                order by ts desc
                limit 1
                """
            ),
            {"org_id": str(org_id)},
        )
        audit_row = row.mappings().one()
    assert audit_row["action"] == "patch"
    assert audit_row["entity_id"] == str(incident_id)
    assert audit_row["before_json"] is not None
    assert audit_row["after_json"] is not None


@pytest.mark.asyncio
async def test_patch_assign_endpoint_404_when_assignee_missing(seeded_incidents) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_incidents["org_id"]
    incident_id = seeded_incidents["incident_a"]
    missing_user_id = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.patch(
            f"/api/operations/incidents/{incident_id}/assign",
            json={"assigned_to": str(missing_user_id)},
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_post_incident_attachments_returns_presigned_key(seeded_incidents) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_incidents["org_id"]
    incident_id = seeded_incidents["incident_a"]

    def _fake_presign_put(*, key: str, content_type: str):  # type: ignore[no-untyped-def]
        from app.storage.s3 import PresignedPut

        return PresignedPut(url=f"https://example.com/upload/{key}", headers={"content-type": content_type})

    s3mod.presign_put = _fake_presign_put  # type: ignore[assignment]

    async with _client_for_org(org_id=org_id) as client:
        resp = await client.post(
            f"/api/operations/incidents/{incident_id}/attachments",
            json={"filename": "photo.png", "content_type": "image/png"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert "key" in body and str(incident_id) in body["key"]
    assert body["upload_url"].startswith("https://example.com/upload/")
    assert body["upload_headers"]["content-type"] == "image/png"

