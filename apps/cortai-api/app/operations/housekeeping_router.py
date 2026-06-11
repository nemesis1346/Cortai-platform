from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Query
from sqlalchemy import text

from app.db import SessionDep
from app.operations.housekeeping_schemas import HousekeepingSummary
from app.operations.rbac import OperationsPrincipalDep

router = APIRouter(prefix="/housekeeping", tags=["operations-housekeeping"])


@router.get("/summary", response_model=HousekeepingSummary)
async def get_housekeeping_summary(
    principal: OperationsPrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID | None = Query(default=None),
) -> HousekeepingSummary:
    now = datetime.now(UTC)
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)

    # Count rooms assigned (today) and distinct staff on assignments (today).
    counts = (
        await session.execute(
            text(
                """
                select
                  count(*)::int as rooms_assigned,
                  count(distinct attendant_user_id)::int as staff_count,
                  count(*) filter (where status in ('done','inspected'))::int as done_count,
                  count(*) filter (where status in ('in_progress','inspected'))::int as in_process,
                  count(*) filter (where status = 'queued')::int as in_transit,
                  count(*) filter (where status = 'break')::int as on_break,
                  count(*) filter (where status = 'dnd')::int as dnd,
                  coalesce(avg(extract(epoch from (finished_at - started_at))), 0)::float as avg_clean_seconds
                from ops.housekeeping_assignments
                where org_id = :org_id
                  and property_id = coalesce(:property_id, property_id)
                  and created_at >= :sod and created_at < :eod
                """
            ),
            {
                "org_id": principal.org_id,
                "property_id": property_id,
                "sod": start_of_day,
                "eod": end_of_day,
            },
        )
    ).mappings().one()

    rooms_assigned = int(counts["rooms_assigned"] or 0)
    staff_count = int(counts["staff_count"] or 0)
    done_count = int(counts["done_count"] or 0)

    avg_per_staff = (rooms_assigned / staff_count) if staff_count > 0 else 0.0
    done_pct = (done_count / rooms_assigned * 100.0) if rooms_assigned > 0 else 0.0

    # Efficiency proxy: completed rooms / (assigned rooms) as a percent.
    efficiency_pct = done_pct

    return HousekeepingSummary(
        rooms_assigned=rooms_assigned,
        staff_count=staff_count,
        avg_per_staff=float(avg_per_staff),
        done_pct=float(done_pct),
        efficiency_pct=float(efficiency_pct),
        avg_clean_seconds=float(counts["avg_clean_seconds"] or 0.0),
        in_process=int(counts["in_process"] or 0),
        in_transit=int(counts["in_transit"] or 0),
        on_break=int(counts["on_break"] or 0),
        dnd=int(counts["dnd"] or 0),
    )

