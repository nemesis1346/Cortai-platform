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
async def seeded_booking_for_setup_status() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="Meetings SetupStatus Org", slug=f"meetings-ss-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status, room_count)
                values (:p, :org, 'Hotel Meetings', :slug, :now, :now, 'ACTIVE', 200)
                """
            ),
            {"p": prop_id, "org": org_id, "slug": f"hotel-meetings-{org_id}", "now": now},
        )
        room_row = (
            await session.execute(
                text(
                    """
                    insert into ops.meeting_rooms (id, org_id, property_id, name, capacity, equipment, created_at, updated_at)
                    values (gen_random_uuid(), :org_id, :property_id, 'Ballroom A', 120, '{}'::text[], :now, :now)
                    returning id
                    """
                ),
                {"org_id": str(org_id), "property_id": str(prop_id), "now": now},
            )
        ).mappings().one()
        room_id = uuid.UUID(str(room_row["id"]))

        starts = now + timedelta(days=1)
        ends = starts + timedelta(hours=2)
        booking_row = (
            await session.execute(
                text(
                    """
                    insert into ops.meeting_bookings (
                      id, org_id, property_id, meeting_room_id, organizer_guest_id_or_user_id,
                      title, attendees_count, starts_at, ends_at, setup_status,
                      created_at, updated_at
                    )
                    values (
                      gen_random_uuid(), :org_id, :property_id, :room_id, null,
                      'Board meeting', 10, :starts_at, :ends_at, 'setup',
                      :now, :now
                    )
                    returning id
                    """
                ),
                {
                    "org_id": str(org_id),
                    "property_id": str(prop_id),
                    "room_id": str(room_id),
                    "starts_at": starts,
                    "ends_at": ends,
                    "now": now,
                },
            )
        ).mappings().one()
        booking_id = uuid.UUID(str(booking_row["id"]))
        await session.commit()

    yield {"org_id": org_id, "booking_id": booking_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.meeting_bookings where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.meeting_rooms where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_meetings_booking_setup_status_post(seeded_booking_for_setup_status) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_booking_for_setup_status["org_id"]
    booking_id = seeded_booking_for_setup_status["booking_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.post(
            f"/api/operations/meetings/bookings/{booking_id}/setup-status",
            json={"setup_status": "ready"},
        )
    assert resp.status_code == 200
    assert resp.json()["setup_status"] == "ready"


@pytest.mark.asyncio
async def test_meetings_booking_setup_status_404_when_missing(seeded_booking_for_setup_status) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_booking_for_setup_status["org_id"]
    missing = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.post(f"/api/operations/meetings/bookings/{missing}/setup-status", json={"setup_status": "ready"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_meetings_booking_setup_status_400_on_invalid_value(seeded_booking_for_setup_status) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_booking_for_setup_status["org_id"]
    booking_id = seeded_booking_for_setup_status["booking_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.post(
            f"/api/operations/meetings/bookings/{booking_id}/setup-status",
            json={"setup_status": "invalid"},
        )
    assert resp.status_code == 422

