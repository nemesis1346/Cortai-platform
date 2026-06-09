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
async def seeded_queue_join() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()
    guest_id = uuid.uuid4()
    reservation_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="FD Queue Org", slug=f"fd-queue-{org_id}"))
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
                values (:gid, :org_id, 'Q', 'Guest', false, 'en', :now, :now)
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
        await session.commit()

    yield {"org_id": org_id, "property_id": prop_id, "reservation_id": reservation_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.front_desk_events where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.reservations where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guests where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_front_desk_queue_join_creates_open_event_and_is_idempotent(seeded_queue_join) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_queue_join["org_id"]
    prop_id = seeded_queue_join["property_id"]
    reservation_id = seeded_queue_join["reservation_id"]

    async with _client_for_org(org_id=org_id) as client:
        resp1 = await client.post(
            "/api/operations/front-desk/queue/join",
            json={"property_id": str(prop_id), "reservation_id": str(reservation_id)},
        )
        resp2 = await client.post(
            "/api/operations/front-desk/queue/join",
            json={"property_id": str(prop_id), "reservation_id": str(reservation_id)},
        )

    assert resp1.status_code == 200
    assert resp2.status_code == 200
    body1 = resp1.json()
    body2 = resp2.json()
    assert body1["queue_position"] == 1
    assert body2["queue_position"] == 1
    assert body1["event_id"] == body2["event_id"]

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        row = (
            await session.execute(
                text(
                    """
                    select kind, ended_at, queue_position
                    from ops.front_desk_events
                    where org_id = :org and property_id = :prop and reservation_id = :rid and kind = 'queue_joined'
                    """
                ),
                {"org": str(org_id), "prop": str(prop_id), "rid": str(reservation_id)},
            )
        ).mappings().all()
        assert len(row) == 1
        assert row[0]["kind"] == "queue_joined"
        assert row[0]["ended_at"] is None
        assert int(row[0]["queue_position"]) == 1

