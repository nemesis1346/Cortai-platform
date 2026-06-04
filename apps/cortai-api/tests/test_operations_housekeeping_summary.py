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
async def seeded_housekeeping() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    other_org = uuid.uuid4()
    now = datetime.now(UTC)
    attendant_1 = uuid.uuid4()
    attendant_2 = uuid.uuid4()
    room_1 = uuid.uuid4()
    room_2 = uuid.uuid4()
    room_3 = uuid.uuid4()
    room_4 = uuid.uuid4()

    async with SessionLocal() as session:
        session.add_all(
            [
                Organization(id=org_id, name="HK Org", slug=f"hk-{org_id}"),
                Organization(id=other_org, name="HK Other", slug=f"hk-{other_org}"),
            ]
        )
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        session.add_all(
            [
                User(
                    id=attendant_1,
                    org_id=org_id,
                    email=f"hk-a1-{org_id}@example.com",
                    full_name="HK A1",
                    role=UserRole.STAFF,
                    status=UserStatus.ACTIVE,
                    password_hash="hash",  # noqa: S106
                    created_at=now,
                    updated_at=now,
                ),
                User(
                    id=attendant_2,
                    org_id=org_id,
                    email=f"hk-a2-{org_id}@example.com",
                    full_name="HK A2",
                    role=UserRole.STAFF,
                    status=UserStatus.ACTIVE,
                    password_hash="hash",  # noqa: S106
                    created_at=now,
                    updated_at=now,
                ),
            ]
        )
        # Ensure attendant users exist before inserting housekeeping assignments (FK).
        await session.flush()
        await session.execute(
            text(
                """
                insert into ops.rooms (id, org_id, room_number, floor, type, status, vip, created_at, updated_at)
                values
                  (:r1, :org, '101', 1, 'king', 'vacant_clean', false, :now, :now),
                  (:r2, :org, '102', 1, 'king', 'vacant_clean', false, :now, :now),
                  (:r3, :org, '103', 1, 'king', 'vacant_clean', false, :now, :now),
                  (:r4, :org, '104', 1, 'king', 'vacant_clean', false, :now, :now)
                """
            ),
            {"r1": room_1, "r2": room_2, "r3": room_3, "r4": room_4, "org": org_id, "now": now},
        )

        # 4 assignments today: done, in_progress, queued, dnd
        await session.execute(
            text(
                """
                insert into ops.housekeeping_assignments (
                  id, org_id, attendant_user_id, room_id, status, started_at, finished_at, created_at, updated_at
                )
                values
                  (:a1, :org, :u1, :r1, 'done', :s1, :f1, :now, :now),
                  (:a2, :org, :u1, :r2, 'in_progress', :s2, null, :now, :now),
                  (:a3, :org, :u2, :r3, 'queued', null, null, :now, :now),
                  (:a4, :org, :u2, :r4, 'dnd', null, null, :now, :now)
                """
            ),
            {
                "a1": uuid.uuid4(),
                "a2": uuid.uuid4(),
                "a3": uuid.uuid4(),
                "a4": uuid.uuid4(),
                "org": org_id,
                "u1": attendant_1,
                "u2": attendant_2,
                "r1": room_1,
                "r2": room_2,
                "r3": room_3,
                "r4": room_4,
                "now": now,
                "s1": now - timedelta(minutes=20),
                "f1": now - timedelta(minutes=5),
                "s2": now - timedelta(minutes=10),
            },
        )
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(other_org))
        await session.execute(
            text(
                """
                insert into ops.rooms (id, org_id, room_number, floor, type, status, vip, created_at, updated_at)
                values (:r1, :org, '201', 2, 'king', 'vacant_clean', false, :now, :now)
                """
            ),
            {"r1": uuid.uuid4(), "org": other_org, "now": now},
        )
        await session.commit()

    yield {"org_id": org_id, "other_org": other_org}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text("delete from ops.housekeeping_assignments where org_id = :org"), {"org": org_id}
        )
        await session.execute(text("delete from ops.rooms where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from users where org_id = :org"), {"org": org_id})

        await set_current_org(session, str(other_org))
        await session.execute(text("delete from ops.rooms where org_id = :org"), {"org": other_org})

        await session.execute(
            text("delete from organizations where id in (:a, :b)"),
            {"a": org_id, "b": other_org},
        )
        await session.commit()


@pytest.mark.asyncio
async def test_housekeeping_summary_aggregates(seeded_housekeeping) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_housekeeping["org_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get("/api/operations/housekeeping/summary")
    assert resp.status_code == 200
    body = resp.json()

    assert body["rooms_assigned"] == 4
    assert body["staff_count"] == 2
    assert body["avg_per_staff"] == pytest.approx(2.0)
    assert body["done_pct"] == pytest.approx(25.0)
    assert body["efficiency_pct"] == pytest.approx(25.0)
    # done clean time: 15 min -> 900s (only one completed contributes)
    assert body["avg_clean_seconds"] == pytest.approx(900.0, rel=0.01)
    assert body["in_process"] == 1
    assert body["in_transit"] == 1
    assert body["on_break"] == 0
    assert body["dnd"] == 1

