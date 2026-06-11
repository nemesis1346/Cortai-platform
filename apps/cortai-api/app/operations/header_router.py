from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import text

from app.db import SessionDep
from app.operations.header_schemas import OperationsHeader
from app.operations.rbac import OperationsPrincipalDep

router = APIRouter(prefix="/header", tags=["operations-header"])


@router.get("", response_model=OperationsHeader)
async def get_operations_header(
    principal: OperationsPrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID = Query(...),
) -> OperationsHeader:
    # Validate property belongs to org (RLS-scoped).
    exists = await session.scalar(
        text("select 1 from properties where id = :pid"),
        {"pid": property_id},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    now = datetime.now(UTC)

    # Occupancy across this property: checked-in reservations with room.
    used_rooms = int(
        (
            await session.scalar(
                text(
                    """
                    select count(distinct room_id)::int
                    from ops.reservations
                    where org_id = :org_id
                      and property_id = :property_id
                      and room_id is not null
                      and status = 'checked_in'
                      and check_in_at <= :now
                      and check_out_at > :now
                    """
                ),
                {
                    "org_id": principal.org_id,
                    "property_id": property_id,
                    "now": now,
                },
            )
        )
        or 0
    )

    total_rooms = int(
        (
            await session.scalar(
                text("select coalesce(room_count, 0)::int from properties where id = :pid"),
                {"pid": property_id},
            )
        )
        or 0
    )
    occupancy_pct = float((used_rooms / total_rooms) * 100.0) if total_rooms > 0 else 0.0

    active_alerts = int(
        (
            await session.scalar(
                text(
                    """
                    select count(*)::int
                    from ops.action_queue
                    where org_id = :org_id
                      and property_id = :property_id
                      and status = 'urgent'
                    """
                ),
                {"org_id": principal.org_id, "property_id": property_id},
            )
        )
        or 0
    )

    # AI bridge "live" mode is configured on your side; reflect env if present.
    ai_mode = os.getenv("CORTAI_AI_MODE", "").lower().strip()
    ai_live = ai_mode == "real"

    # Placeholder constant until guest rating data lands.
    rating = 4.6

    return OperationsHeader(
        property_id=property_id,
        ai_live=ai_live,
        occupancy_pct=occupancy_pct,
        active_alerts=active_alerts,
        rating=rating,
    )

