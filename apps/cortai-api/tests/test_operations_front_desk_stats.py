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
async def seeded_front_desk_events() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    other_org = uuid.uuid4()
    now = datetime.now(UTC)

    async with SessionLocal() as session:
        session.add_all(
            [
                Organization(id=org_id, name="FD Org", slug=f"fd-{org_id}"),
                Organization(id=other_org, name="FD Other", slug=f"fd-{other_org}"),
            ]
        )
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into ops.front_desk_events (id, org_id, kind, guest_id, reservation_id, queue_position, started_at, ended_at, created_at, updated_at)
                values
                  (:q_joined_done, :org, 'queue_joined', null, null, 1, :t0, :t1, :now, :now),
                  (:served, :org, 'served', null, null, 1, :t1, :t2, :now, :now),
                  (:checkin, :org, 'checked_in', null, null, null, :t2, :t3, :now, :now),
                  (:q_joined_open, :org, 'queue_joined', null, null, 2, :t3, null, :now, :now)
                """
            ),
            {
                "org": org_id,
                "now": now,
                "q_joined_done": uuid.uuid4(),
                "served": uuid.uuid4(),
                "checkin": uuid.uuid4(),
                "q_joined_open": uuid.uuid4(),
                "t0": now - timedelta(minutes=30),
                "t1": now - timedelta(minutes=25),
                "t2": now - timedelta(minutes=15),
                "t3": now - timedelta(minutes=5),
            },
        )
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(other_org))
        await session.execute(
            text(
                """
                insert into ops.front_desk_events (id, org_id, kind, guest_id, reservation_id, queue_position, started_at, ended_at, created_at, updated_at)
                values (:id, :org, 'served', null, null, 1, :now, :now, :now, :now)
                """
            ),
            {"id": uuid.uuid4(), "org": other_org, "now": now},
        )
        await session.commit()

    yield {"org_id": org_id, "other_org": other_org}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.front_desk_events where org_id = :org"), {"org": org_id})
        await set_current_org(session, str(other_org))
        await session.execute(text("delete from ops.front_desk_events where org_id = :org"), {"org": other_org})
        await session.execute(
            text("delete from organizations where id in (:a, :b)"),
            {"a": org_id, "b": other_org},
        )
        await session.commit()


@pytest.mark.asyncio
async def test_front_desk_stats_aggregates_today(seeded_front_desk_events) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_front_desk_events["org_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get("/api/operations/front-desk/stats")
    assert resp.status_code == 200
    body = resp.json()

    assert body["served_today"] == 1
    assert body["in_queue_now"] == 1
    # one completed queue_joined: 5 minutes -> 300 seconds
    assert body["queue_avg_seconds"] == pytest.approx(300.0, rel=0.01)
    # one checkin event: 10 minutes -> 600 seconds
    assert body["checkin_avg_seconds"] == pytest.approx(600.0, rel=0.01)

