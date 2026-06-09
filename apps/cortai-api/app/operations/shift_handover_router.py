from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep
from app.operations.shift_handover_schemas import ShiftHandoverCurrent, ShiftHandoverRead, ShiftLabel

router = APIRouter(prefix="/shift-handover", tags=["operations-shift-handover"])


def _current_shift_label(now_utc: datetime) -> ShiftLabel:
    # Simple default: split UTC day into 3 shifts.
    h = now_utc.hour
    if 6 <= h < 14:
        return ShiftLabel.MORNING
    if 14 <= h < 22:
        return ShiftLabel.AFTERNOON
    return ShiftLabel.NIGHT


@router.get("/current", response_model=ShiftHandoverCurrent)
async def get_current_shift_handover(
    principal: PrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID = Query(...),
    shift_date: date | None = Query(default=None),
    shift_label: ShiftLabel | None = Query(default=None),
) -> ShiftHandoverCurrent:
    # Validate property belongs to org (RLS-scoped).
    exists = await session.scalar(text("select 1 from properties where id = :pid"), {"pid": property_id})
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    now = datetime.now(UTC)
    sd = shift_date or now.date()
    sl = shift_label or _current_shift_label(now)

    row = (
        await session.execute(
            text(
                """
                select
                  id, org_id, property_id, shift_date, shift_label,
                  summary_md, checklist_json,
                  signed_by_user_id, signed_at, carry_forward_from_id,
                  created_at, updated_at
                from ops.shift_handover
                where org_id = :org_id
                  and property_id = :property_id
                  and shift_date = :shift_date
                  and shift_label = :shift_label
                order by created_at desc
                limit 1
                """
            ),
            {
                "org_id": str(principal.org_id),
                "property_id": str(property_id),
                "shift_date": sd,
                "shift_label": sl.value,
            },
        )
    ).mappings().first()

    return ShiftHandoverCurrent(
        property_id=property_id,
        shift_date=sd,
        shift_label=sl,
        handover=ShiftHandoverRead(**dict(row)) if row is not None else None,
    )

