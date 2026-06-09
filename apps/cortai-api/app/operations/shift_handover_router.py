from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import sqlalchemy as sa
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep
from app.operations.shift_handover_schemas import (
    ShiftHandoverCurrent,
    ShiftHandoverRead,
    ShiftHandoverSignoffRequest,
    ShiftHandoverSignoffResponse,
    ShiftLabel,
)

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


def _next_shift(*, shift_date: date, shift_label: ShiftLabel) -> tuple[date, ShiftLabel]:
    if shift_label == ShiftLabel.MORNING:
        return shift_date, ShiftLabel.AFTERNOON
    if shift_label == ShiftLabel.AFTERNOON:
        return shift_date, ShiftLabel.NIGHT
    # night -> next day morning
    return shift_date.fromordinal(shift_date.toordinal() + 1), ShiftLabel.MORNING


@router.post("", response_model=ShiftHandoverSignoffResponse)
async def signoff_shift_handover(
    payload: ShiftHandoverSignoffRequest,
    principal: PrincipalDep,
    session: SessionDep,
) -> ShiftHandoverSignoffResponse:
    # Validate property belongs to org (RLS-scoped).
    exists = await session.scalar(text("select 1 from properties where id = :pid"), {"pid": payload.property_id})
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    now = datetime.now(UTC)
    sd = payload.shift_date or now.date()
    sl = payload.shift_label or _current_shift_label(now)

    # Create or update the current shift record, and sign it.
    # Prefer update if it already exists (latest row for that shift).
    existing_id = await session.scalar(
        text(
            """
            select id
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
            "property_id": str(payload.property_id),
            "shift_date": sd,
            "shift_label": sl.value,
        },
    )

    if existing_id is None:
        stmt = (
            text(
            """
            insert into ops.shift_handover (
              id, org_id, property_id, shift_date, shift_label,
              summary_md, checklist_json,
              signed_by_user_id, signed_at, carry_forward_from_id,
              created_at, updated_at
            )
            values (
              :id, :org_id, :property_id, :shift_date, :shift_label,
              :summary_md, :checklist_json,
              :signed_by_user_id, :signed_at, null,
              :now, :now
            )
            returning
              id, org_id, property_id, shift_date, shift_label,
              summary_md, checklist_json,
              signed_by_user_id, signed_at, carry_forward_from_id,
              created_at, updated_at
            """
            )
            .bindparams(sa.bindparam("checklist_json", type_=postgresql.JSONB))
        )
        row = (
            await session.execute(
                stmt,
                {
                    "id": str(uuid.uuid4()),
                    "org_id": str(principal.org_id),
                    "property_id": str(payload.property_id),
                    "shift_date": sd,
                    "shift_label": sl.value,
                    "summary_md": payload.summary_md,
                    "checklist_json": jsonable_encoder(payload.checklist_json),
                    "signed_by_user_id": str(principal.user_id),
                    "signed_at": now,
                    "now": now,
                },
            )
        ).mappings().one()
    else:
        stmt = (
            text(
            """
            update ops.shift_handover
            set summary_md = :summary_md,
                checklist_json = :checklist_json,
                signed_by_user_id = :signed_by_user_id,
                signed_at = :signed_at
            where id = :id and org_id = :org_id
            returning
              id, org_id, property_id, shift_date, shift_label,
              summary_md, checklist_json,
              signed_by_user_id, signed_at, carry_forward_from_id,
              created_at, updated_at
            """
            )
            .bindparams(sa.bindparam("checklist_json", type_=postgresql.JSONB))
        )
        row = (
            await session.execute(
                stmt,
                {
                    "id": str(existing_id),
                    "org_id": str(principal.org_id),
                    "summary_md": payload.summary_md,
                    "checklist_json": jsonable_encoder(payload.checklist_json),
                    "signed_by_user_id": str(principal.user_id),
                    "signed_at": now,
                },
            )
        ).mappings().one()

    signed = ShiftHandoverRead(**dict(row))

    next_handover: ShiftHandoverRead | None = None
    if payload.start_next:
        next_date, next_label = _next_shift(shift_date=sd, shift_label=sl)

        next_existing = await session.scalar(
            text(
                """
                select id
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
                "property_id": str(payload.property_id),
                "shift_date": next_date,
                "shift_label": next_label.value,
            },
        )

        if next_existing is None:
            next_checklist = (
                payload.next_checklist_json
                if payload.next_checklist_json is not None
                else payload.checklist_json
            )
            stmt = (
                text(
                """
                insert into ops.shift_handover (
                  id, org_id, property_id, shift_date, shift_label,
                  summary_md, checklist_json,
                  signed_by_user_id, signed_at, carry_forward_from_id,
                  created_at, updated_at
                )
                values (
                  :id, :org_id, :property_id, :shift_date, :shift_label,
                  :summary_md, :checklist_json,
                  null, null, :carry_forward_from_id,
                  :now, :now
                )
                returning
                  id, org_id, property_id, shift_date, shift_label,
                  summary_md, checklist_json,
                  signed_by_user_id, signed_at, carry_forward_from_id,
                  created_at, updated_at
                """
                )
                .bindparams(sa.bindparam("checklist_json", type_=postgresql.JSONB))
            )
            nxt = (
                await session.execute(
                    stmt,
                    {
                        "id": str(uuid.uuid4()),
                        "org_id": str(principal.org_id),
                        "property_id": str(payload.property_id),
                        "shift_date": next_date,
                        "shift_label": next_label.value,
                        "summary_md": payload.next_summary_md,
                        "checklist_json": jsonable_encoder(next_checklist),
                        "carry_forward_from_id": str(signed.id),
                        "now": now,
                    },
                )
            ).mappings().one()
            next_handover = ShiftHandoverRead(**dict(nxt))
        else:
            # If it already exists, do not mutate it; just return it for convenience.
            nxt = (
                await session.execute(
                    text(
                        """
                        select
                          id, org_id, property_id, shift_date, shift_label,
                          summary_md, checklist_json,
                          signed_by_user_id, signed_at, carry_forward_from_id,
                          created_at, updated_at
                        from ops.shift_handover
                        where id = :id and org_id = :org_id
                        """
                    ),
                    {"id": str(next_existing), "org_id": str(principal.org_id)},
                )
            ).mappings().first()
            if nxt is not None:
                next_handover = ShiftHandoverRead(**dict(nxt))

    await session.commit()
    return ShiftHandoverSignoffResponse(signed=signed, next=next_handover)

