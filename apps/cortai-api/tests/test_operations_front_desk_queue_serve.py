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
async def seeded_queue_serve() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()

    guest_a = uuid.uuid4()
    guest_b = uuid.uuid4()
    res_a = uuid.uuid4()
    res_b = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="FD Queue Serve Org", slug=f"fd-queue-serve-{org_id}"))
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
                values
                  (:g1, :org_id, 'A', 'Guest', false, 'en', :now, :now),
                  (:g2, :org_id, 'B', 'Guest', false, 'en', :now, :now)
                """
            ),
            {"g1": guest_a, "g2": guest_b, "org_id": org_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.reservations (
                  id, org_id, guest_id, property_id, room_id, status,
                  check_in_at, check_out_at, rate_cents, group_id, source, created_at, updated_at
                )
                values
                  (:r1, :org_id, :g1, :prop_id, null, 'booked', :in1, :out1, null, null, 'pms', :now, :now),
                  (:r2, :org_id, :g2, :prop_id, null, 'booked', :in2, :out2, null, null, 'pms', :now, :now)
                """
            ),
            {
                "r1": res_a,
                "r2": res_b,
                "org_id": org_id,
                "g1": guest_a,
                "g2": guest_b,
                "prop_id": prop_id,
                "in1": now + timedelta(hours=2),
                "out1": now + timedelta(days=1),
                "in2": now + timedelta(hours=3),
                "out2": now + timedelta(days=1),
                "now": now,
            },
        )
        # Insert two open queue events with positions 1 and 2.
        await session.execute(
            text(
                """
                insert into ops.front_desk_events (
                  id, org_id, property_id, kind, guest_id, reservation_id,
                  queue_position, started_at, ended_at, created_at, updated_at
                )
                values
                  (:e1, :org_id, :prop_id, 'queue_joined', :g1, :r1, 1, :t1, null, :now, :now),
                  (:e2, :org_id, :prop_id, 'queue_joined', :g2, :r2, 2, :t2, null, :now, :now)
                """
            ),
            {
                "e1": uuid.uuid4(),
                "e2": uuid.uuid4(),
                "org_id": org_id,
                "prop_id": prop_id,
                "g1": guest_a,
                "g2": guest_b,
                "r1": res_a,
                "r2": res_b,
                "t1": now - timedelta(minutes=5),
                "t2": now - timedelta(minutes=1),
                "now": now,
            },
        )
        await session.commit()

    yield {"org_id": org_id, "property_id": prop_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.front_desk_events where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.reservations where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guests where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_front_desk_queue_serve_pops_oldest_and_records_served(seeded_queue_serve) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_queue_serve["org_id"]
    prop_id = seeded_queue_serve["property_id"]

    async with _client_for_org(org_id=org_id) as client:
        resp = await client.post("/api/operations/front-desk/queue/serve", json={"property_id": str(prop_id)})
    assert resp.status_code == 200
    body = resp.json()
    assert body["queue_position"] == 1

    served_res_id = body["reservation_id"]
    served_join_event_id = body["queue_join_event_id"]

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        join = (
            await session.execute(
                text(
                    """
                    select ended_at, kind
                    from ops.front_desk_events
                    where id = :id and org_id = :org
                    """
                ),
                {"id": served_join_event_id, "org": str(org_id)},
            )
        ).mappings().one()
        assert join["kind"] == "queue_joined"
        assert join["ended_at"] is not None

        served = (
            await session.execute(
                text(
                    """
                    select kind, reservation_id, queue_position
                    from ops.front_desk_events
                    where org_id = :org and property_id = :prop and kind = 'served'
                    order by created_at desc
                    limit 1
                    """
                ),
                {"org": str(org_id), "prop": str(prop_id)},
            )
        ).mappings().one()
        assert served["kind"] == "served"
        assert str(served["reservation_id"]) == str(served_res_id)
        assert int(served["queue_position"]) == 1

