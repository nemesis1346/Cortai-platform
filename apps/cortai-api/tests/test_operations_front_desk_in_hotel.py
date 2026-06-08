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
async def seeded_in_hotel() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_a = uuid.uuid4()
    prop_b = uuid.uuid4()

    g_vip = uuid.uuid4()
    g_norm = uuid.uuid4()
    r_vip = uuid.uuid4()
    r_past = uuid.uuid4()
    r_future = uuid.uuid4()
    r_other_prop = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="FD InHotel Org", slug=f"fd-inhotel-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
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
                insert into ops.guests (id, org_id, first_name, last_name, vip, language, created_at, updated_at)
                values
                  (:gvip, :org, 'Vip', 'Guest', true, 'en', :now, :now),
                  (:gn, :org, 'Norm', 'Guest', false, 'en', :now, :now)
                """
            ),
            {"gvip": g_vip, "gn": g_norm, "org": org_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.reservations (
                  id, org_id, guest_id, property_id, room_id, status,
                  check_in_at, check_out_at, rate_cents, group_id, source,
                  created_at, updated_at
                )
                values
                  (:rvip, :org, :gvip, :p1, null, 'checked_in',
                   :in1, :out1, 10000, null, 'pms', :now, :now),
                  (:rpast, :org, :gn, :p1, null, 'checked_in',
                   :in2, :out2, 10000, null, 'pms', :now, :now),
                  (:rfuture, :org, :gn, :p1, null, 'checked_in',
                   :in3, :out3, 10000, null, 'pms', :now, :now),
                  (:rother, :org, :gn, :p2, null, 'checked_in',
                   :in1, :out1, 10000, null, 'pms', :now, :now)
                """
            ),
            {
                "rvip": r_vip,
                "rpast": r_past,
                "rfuture": r_future,
                "rother": r_other_prop,
                "org": org_id,
                "gvip": g_vip,
                "gn": g_norm,
                "p1": prop_a,
                "p2": prop_b,
                "in1": now - timedelta(hours=1),
                "out1": now + timedelta(hours=2),
                "in2": now - timedelta(days=2),
                "out2": now - timedelta(days=1),
                "in3": now + timedelta(hours=1),
                "out3": now + timedelta(days=1),
                "now": now,
            },
        )
        await session.commit()

    yield {"org_id": org_id, "property_id": prop_a}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.reservations where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guests where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_front_desk_in_hotel_only_returns_active_checked_in(seeded_in_hotel) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_in_hotel["org_id"]
    prop_id = seeded_in_hotel["property_id"]

    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/front-desk/in-hotel?property_id={prop_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["guest"]["vip"] is True

