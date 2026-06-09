import uuid
from datetime import UTC, date, datetime

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
async def seeded_shift_handover() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()
    handover_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="Shift Org", slug=f"shift-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status, room_count)
                values (:id, :org, 'Shift Hotel', :slug, :now, :now, 'ACTIVE', 10)
                """
            ),
            {"id": prop_id, "org": org_id, "slug": f"shift-hotel-{org_id}", "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.shift_handover (
                  id, org_id, property_id, shift_date, shift_label,
                  summary_md, checklist_json,
                  signed_by_user_id, signed_at, carry_forward_from_id,
                  created_at, updated_at
                )
                values (
                  :id, :org, :prop, :d, 'morning',
                  'Hello', '{}'::jsonb,
                  null, null, null,
                  :now, :now
                )
                """
            ),
            {"id": handover_id, "org": org_id, "prop": prop_id, "d": date.today(), "now": now},
        )
        await session.commit()

    yield {"org_id": org_id, "property_id": prop_id, "handover_id": handover_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.shift_handover where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_get_shift_handover_current_returns_latest(seeded_shift_handover) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_shift_handover["org_id"]
    prop_id = seeded_shift_handover["property_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(
            f"/api/operations/shift-handover/current?property_id={prop_id}&shift_label=morning"
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["property_id"] == str(prop_id)
    assert body["handover"] is not None
    assert body["handover"]["summary_md"] == "Hello"


@pytest.mark.asyncio
async def test_get_shift_handover_current_returns_null_when_missing(seeded_shift_handover) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_shift_handover["org_id"]
    prop_id = seeded_shift_handover["property_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(
            f"/api/operations/shift-handover/current?property_id={prop_id}&shift_label=night"
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["handover"] is None

