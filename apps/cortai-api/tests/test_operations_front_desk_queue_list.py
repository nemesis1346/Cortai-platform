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
async def seeded_queue_list() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()
    guest_id = uuid.uuid4()
    reservation_id = uuid.uuid4()
    event_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="FD Queue List Org", slug=f"fd-queue-list-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status)
                values (:id, :org_id, 'FD Hotel', :slug, :now, :now, 'ACTIVE')
                """
            ),
            {"id": prop_id, "org_id": org_id, "slug": f"fd-hotel-{org_id}", "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.guests (id, org_id, first_name, last_name, vip, language, created_at, updated_at)
                values (:gid, :org_id, 'Queue', 'Guest', true, 'en', :now, :now)
                """
            ),
            {"gid": guest_id, "org_id": org_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.reservations (
                  id, org_id, guest_id, property_id, room_id, status,
                  check_in_at, check_out_at, rate_cents, group_id, source,
                  created_at, updated_at
                )
                values (
                  :rid, :org_id, :gid, :prop_id, null, 'booked',
                  :in_at, :out_at, null, null, 'pms',
                  :now, :now
                )
                """
            ),
            {
                "rid": reservation_id,
                "org_id": org_id,
                "gid": guest_id,
                "prop_id": prop_id,
                "in_at": now + timedelta(hours=2),
                "out_at": now + timedelta(days=1),
                "now": now,
            },
        )
        await session.execute(
            text(
                """
                insert into ops.front_desk_events (
                  id, org_id, property_id, kind, guest_id, reservation_id,
                  queue_position, started_at, ended_at, created_at, updated_at
                )
                values (
                  :id, :org_id, :prop_id, 'queue_joined', :gid, :rid,
                  1, :t, null, :now, :now
                )
                """
            ),
            {"id": event_id, "org_id": org_id, "prop_id": prop_id, "gid": guest_id, "rid": reservation_id, "t": now, "now": now},
        )
        await session.commit()

    yield {"org_id": org_id, "property_id": prop_id, "event_id": event_id, "reservation_id": reservation_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.front_desk_events where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.reservations where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guests where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_front_desk_queue_list_returns_open_queue(seeded_queue_list) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_queue_list["org_id"]
    prop_id = seeded_queue_list["property_id"]

    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get(f"/api/operations/front-desk/queue?property_id={prop_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["queue_position"] == 1
    assert body["items"][0]["guest"]["vip"] is True

