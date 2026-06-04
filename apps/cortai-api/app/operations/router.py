from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep
from app.operations.schemas import OperationsKpis
from app.operations.action_queue_get_router import router as action_queue_get_router
from app.operations.action_queue_patch_router import router as action_queue_patch_router
from app.operations.action_queue_post_router import router as action_queue_post_router
from app.operations.incidents_router import router as incidents_router

router = APIRouter(prefix="/api/operations", tags=["operations"])
AuthedPrincipalDep = Annotated[PrincipalDep, Depends()]


@router.get("/kpis", response_model=OperationsKpis)
async def get_kpis(principal: PrincipalDep, session: SessionDep) -> OperationsKpis:
    """
    Command Center KPIs sourced from ops.* tables (no mocks).
    """
    now = datetime.now(UTC)
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)

    # Rooms: total count and readiness.
    rooms_row = (
        await session.execute(
            text(
                """
                select
                  count(*)::int as total,
                  count(*) filter (where status in ('vacant_clean','inspected'))::int as ready,
                  count(*) filter (where status = 'vacant_dirty')::int as dirty
                from ops.rooms
                where org_id = :org_id
                """
            ),
            {"org_id": str(principal.org_id)},
        )
    ).mappings().one()

    total_rooms = int(rooms_row["total"] or 0)
    rooms_ready = int(rooms_row["ready"] or 0)
    dirty_rooms = int(rooms_row["dirty"] or 0)

    # Occupancy rooms sourced from reservations (avoid relying on room.status).
    used_rooms = int(
        (
            await session.scalar(
                text(
                    """
                    select count(distinct room_id)::int
                    from ops.reservations
                    where org_id = :org_id
                      and room_id is not null
                      and status = 'checked_in'
                      and check_in_at <= :now
                      and check_out_at > :now
                    """
                ),
                {"org_id": str(principal.org_id), "now": now},
            )
        )
        or 0
    )
    occupancy_pct = float((used_rooms / total_rooms) * 100.0) if total_rooms > 0 else 0.0

    # Housekeeping: rooms actively being cleaned (queued/in progress).
    rooms_cleaning = int(
        (
            await session.scalar(
                text(
                    """
                    select count(distinct room_id)::int
                    from ops.housekeeping_assignments
                    where org_id = :org_id
                      and status in ('queued', 'in_progress')
                    """
                ),
                {"org_id": str(principal.org_id)},
            )
        )
        or 0
    )
    # If there are dirty rooms but no assignments yet, reflect backlog.
    rooms_cleaning = max(rooms_cleaning, dirty_rooms)

    # Guests: current in-hotel and today's arrivals/departures.
    guests_row: dict[str, Any] = (
        await session.execute(
            text(
                """
                select
                  count(*) filter (
                    where status = 'checked_in'
                      and check_in_at <= :now
                      and check_out_at > :now
                  )::int as in_hotel,
                  count(*) filter (
                    where status not in ('cancelled','no_show')
                      and check_in_at >= :sod and check_in_at < :eod
                  )::int as arrivals_count,
                  count(*) filter (
                    where status in ('checked_in','checked_out')
                      and check_in_at >= :sod and check_in_at < :eod
                  )::int as arrivals_arrived,
                  count(*) filter (
                    where status not in ('cancelled','no_show')
                      and check_out_at >= :sod and check_out_at < :eod
                  )::int as departures_count,
                  count(*) filter (
                    where status = 'checked_out'
                      and check_out_at >= :sod and check_out_at < :eod
                  )::int as departures_departed
                from ops.reservations
                where org_id = :org_id
                """
            ),
            {
                "org_id": str(principal.org_id),
                "now": now,
                "sod": start_of_day,
                "eod": end_of_day,
            },
        )
    ).mappings().one()

    guests_in_hotel = int(guests_row["in_hotel"] or 0)
    # No explicit guest capacity model yet; approximate as 2 guests/room.
    guests_total_capacity = total_rooms * 2

    # Staff: placeholders until an explicit attendance/shift system exists.
    # We can at least count active staff users in the org; "on duty" approximated as same.
    staff_row = (
        await session.execute(
            text(
                """
                select
                  count(*)::int as staff
                from users
                where org_id = :org_id
                  and status = 'ACTIVE'
                  and role in ('HOTEL_ADMIN','STAFF')
                """
            ),
            {"org_id": str(principal.org_id)},
        )
    ).mappings().one()
    staff_on_site = int(staff_row["staff"] or 0)
    staff_on_duty = int(staff_row["staff"] or 0)

    return OperationsKpis(
        occupancy_pct=occupancy_pct,
        occupancy_rooms={"used": used_rooms, "total": total_rooms},
        guests_in_hotel=guests_in_hotel,
        guests_total_capacity=guests_total_capacity,
        staff_on_site=staff_on_site,
        staff_on_duty=staff_on_duty,
        arrivals_today={
            "count": int(guests_row["arrivals_count"] or 0),
            "arrived": int(guests_row["arrivals_arrived"] or 0),
        },
        departures_today={
            "count": int(guests_row["departures_count"] or 0),
            "departed": int(guests_row["departures_departed"] or 0),
        },
        rooms_ready=rooms_ready,
        rooms_cleaning=rooms_cleaning,
    )


# Nest incidents under /api/operations/incidents/*
router.include_router(incidents_router)

# Command Center action queue under /api/operations/action-queue
router.include_router(action_queue_get_router)
router.include_router(action_queue_post_router)
router.include_router(action_queue_patch_router)

