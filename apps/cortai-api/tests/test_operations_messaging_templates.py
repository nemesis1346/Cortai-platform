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
async def seeded_org_with_templates() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    tpl_a = uuid.uuid4()
    tpl_b = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="Messaging Templates Org", slug=f"tpl-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into ops.guest_message_templates (id, org_id, name, language, body_template, variables, created_at, updated_at)
                values
                  (:a, :org, 'Welcome', 'en', 'Welcome {{guest_name}}', array['guest_name'], :now, :now),
                  (:b, :org, 'Bienvenue', 'fr', 'Bienvenue {{guest_name}}', array['guest_name'], :now, :now)
                """
            ),
            {"a": tpl_a, "b": tpl_b, "org": org_id, "now": now},
        )
        await session.commit()

    yield {"org_id": org_id, "tpl_a": tpl_a, "tpl_b": tpl_b}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.guest_message_templates where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_messaging_templates_list(seeded_org_with_templates) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_org_with_templates["org_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get("/api/operations/messaging/templates")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 2


@pytest.mark.asyncio
async def test_messaging_templates_list_filters(seeded_org_with_templates) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_org_with_templates["org_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get("/api/operations/messaging/templates?language=fr")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["language"] == "fr"


@pytest.mark.asyncio
async def test_messaging_templates_create_and_patch(seeded_org_with_templates) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_org_with_templates["org_id"]
    async with _client_for_org(org_id=org_id) as client:
        created = await client.post(
            "/api/operations/messaging/templates",
            json={"name": "Late checkout", "language": "en", "body_template": "We can do late checkout.", "variables": []},
        )
        assert created.status_code == 201
        tpl_id = created.json()["id"]

        patched = await client.patch(
            f"/api/operations/messaging/templates/{tpl_id}",
            json={"name": "Late checkout (updated)", "variables": ["room_number"]},
        )
        assert patched.status_code == 200
        assert patched.json()["name"] == "Late checkout (updated)"
        assert patched.json()["variables"] == ["room_number"]


@pytest.mark.asyncio
async def test_messaging_templates_patch_404(seeded_org_with_templates) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_org_with_templates["org_id"]
    missing = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.patch(f"/api/operations/messaging/templates/{missing}", json={"name": "X"})
    assert resp.status_code == 404

