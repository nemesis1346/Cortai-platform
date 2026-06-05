import os
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
async def seeded_header_env() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    other_org = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()
    guest_id = uuid.uuid4()
    room_id = uuid.uuid4()
    res_id = uuid.uuid4()
    urgent_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add_all(
            [
                Organization(id=org_id, name="Header Org", slug=f"hdr-{org_id}"),
                Organization(id=other_org, name="Header Other Org", slug=f"hdr-{other_org}"),
            ]
        )
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status, room_count)
                values (:id, :org, 'Header Hotel', :slug, :now, :now, 'ACTIVE', 10)
                """
            ),
            {"id": prop_id, "org": org_id, "slug": f"hdr-hotel-{org_id}", "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.rooms (id, org_id, property_id, room_number, floor, type, status, vip, created_at, updated_at)
                values (:id, :org, :prop, '101', 1, 'king', 'occupied', false, :now, :now)
                """
            ),
            {"id": room_id, "org": org_id, "prop": prop_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.guests (id, org_id, first_name, last_name, vip, language, created_at, updated_at)
                values (:id, :org, 'A', 'Guest', false, 'en', :now, :now)
                """
            ),
            {"id": guest_id, "org": org_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.reservations (
                  id, org_id, guest_id, property_id, room_id, status, check_in_at, check_out_at, created_at, updated_at
                )
                values (:id, :org, :guest, :prop, :room, 'checked_in', :in_at, :out_at, :now, :now)
                """
            ),
            {
                "id": res_id,
                "org": org_id,
                "guest": guest_id,
                "prop": prop_id,
                "room": room_id,
                "in_at": now - timedelta(hours=1),
                "out_at": now + timedelta(days=1),
                "now": now,
            },
        )
        await session.execute(
            text(
                """
                insert into ops.action_queue (
                  id, org_id, property_id, type, source, room_id, guest_id, title,
                  status, severity, created_at, updated_at
                )
                values (:id, :org, :prop, 'incident', 'System', :room, null, 'Urgent thing', 'urgent', 'urgent', :now, :now)
                """
            ),
            {"id": urgent_id, "org": org_id, "prop": prop_id, "room": room_id, "now": now},
        )
        await session.commit()

    yield {"org_id": org_id, "other_org": other_org, "property_id": prop_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.action_queue where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.reservations where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guests where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.rooms where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await set_current_org(session, str(other_org))
        await session.execute(text("delete from properties where org_id = :org"), {"org": other_org})
        await session.execute(
            text("delete from organizations where id in (:a, :b)"), {"a": org_id, "b": other_org}
        )
        await session.commit()


@pytest.mark.asyncio
async def test_operations_header_returns_expected_fields(seeded_header_env, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_header_env["org_id"]
    prop_id = seeded_header_env["property_id"]
    monkeypatch.setenv("CORTAI_AI_MODE", "real")

    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/header?property_id={prop_id}")
    assert resp.status_code == 200
    body = resp.json()

    assert body["property_id"] == str(prop_id)
    assert body["ai_live"] is True
    assert body["active_alerts"] == 1
    assert body["rating"] == pytest.approx(4.6)
    # 1 used room / 10 total -> 10%
    assert body["occupancy_pct"] == pytest.approx(10.0)


@pytest.mark.asyncio
async def test_operations_header_404_when_property_missing(seeded_header_env) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_header_env["org_id"]
    missing = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/header?property_id={missing}")
    assert resp.status_code == 404

