from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep
from app.operations.front_desk_schemas import FrontDeskStats

router = APIRouter(prefix="/front-desk", tags=["operations-front-desk"])


@router.get("/stats", response_model=FrontDeskStats)
async def get_front_desk_stats(principal: PrincipalDep, session: SessionDep) -> FrontDeskStats:
    now = datetime.now(UTC)
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)

    # Served today: count of served events ending today.
    served_today = int(
        (
            await session.scalar(
                text(
                    """
                    select count(*)::int
                    from ops.front_desk_events
                    where org_id = :org_id
                      and kind = 'served'
                      and ended_at is not null
                      and ended_at >= :sod and ended_at < :eod
                    """
                ),
                {"org_id": str(principal.org_id), "sod": start_of_day, "eod": end_of_day},
            )
        )
        or 0
    )

    # In queue now: queue_joined events not yet ended.
    in_queue_now = int(
        (
            await session.scalar(
                text(
                    """
                    select count(*)::int
                    from ops.front_desk_events
                    where org_id = :org_id
                      and kind = 'queue_joined'
                      and started_at >= :sod and started_at < :eod
                      and ended_at is null
                    """
                ),
                {"org_id": str(principal.org_id), "sod": start_of_day, "eod": end_of_day},
            )
        )
        or 0
    )

    # Average queue time today: queue_joined durations.
    queue_avg_seconds = float(
        (
            await session.scalar(
                text(
                    """
                    select coalesce(avg(extract(epoch from (ended_at - started_at))), 0)::float
                    from ops.front_desk_events
                    where org_id = :org_id
                      and kind = 'queue_joined'
                      and ended_at is not null
                      and started_at >= :sod and started_at < :eod
                    """
                ),
                {"org_id": str(principal.org_id), "sod": start_of_day, "eod": end_of_day},
            )
        )
        or 0.0
    )

    # Average check-in time today: checked_in durations.
    checkin_avg_seconds = float(
        (
            await session.scalar(
                text(
                    """
                    select coalesce(avg(extract(epoch from (ended_at - started_at))), 0)::float
                    from ops.front_desk_events
                    where org_id = :org_id
                      and kind = 'checked_in'
                      and ended_at is not null
                      and started_at >= :sod and started_at < :eod
                    """
                ),
                {"org_id": str(principal.org_id), "sod": start_of_day, "eod": end_of_day},
            )
        )
        or 0.0
    )

    return FrontDeskStats(
        served_today=served_today,
        in_queue_now=in_queue_now,
        queue_avg_seconds=queue_avg_seconds,
        checkin_avg_seconds=checkin_avg_seconds,
    )

