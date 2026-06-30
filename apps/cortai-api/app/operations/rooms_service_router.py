from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import text

from app.db import SessionDep
from app.i18n import LocaleDep, http_err
from app.operations.rbac import OperationsPrincipalDep
from app.operations.rooms_schemas import RoomCleaningLogList, RoomStayHistory

router = APIRouter(prefix="/rooms", tags=["operations-rooms-service"])


@router.get("/{room_id}/cleaning-log", response_model=RoomCleaningLogList)
async def get_room_cleaning_log(
    room_id: uuid.UUID,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> Any:
    exists = await session.scalar(
        text("select 1 from ops.rooms where id = :id and org_id = :org_id"),
        {"id": str(room_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.common.room_not_found", locale))

    total = await session.scalar(
        text(
            "select count(*) from ops.room_cleaning_logs"
            " where room_id = :room_id and org_id = :org_id"
        ),
        {"room_id": str(room_id), "org_id": str(principal.org_id)},
    ) or 0

    rows = (
        await session.execute(
            text(
                """
                select id, room_id, staff_name, clean_type, notes, score_pct, cleaned_at
                from ops.room_cleaning_logs
                where room_id = :room_id and org_id = :org_id
                order by cleaned_at desc
                limit :limit offset :offset
                """
            ),
            {
                "room_id": str(room_id),
                "org_id": str(principal.org_id),
                "limit": limit,
                "offset": offset,
            },
        )
    ).mappings().all()

    return RoomCleaningLogList(items=[dict(r) for r in rows], total=int(total))


@router.get("/{room_id}/stay-history", response_model=RoomStayHistory)
async def get_room_stay_history(
    room_id: uuid.UUID,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> Any:
    exists = await session.scalar(
        text("select 1 from ops.rooms where id = :id and org_id = :org_id"),
        {"id": str(room_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.common.room_not_found", locale))

    total = await session.scalar(
        text(
            "select count(*) from ops.reservations r"
            " where r.room_id = :room_id and r.org_id = :org_id"
            " and r.status in ('checked_in', 'checked_out')"
        ),
        {"room_id": str(room_id), "org_id": str(principal.org_id)},
    ) or 0

    rows = (
        await session.execute(
            text(
                """
                select
                  r.id          as reservation_id,
                  g.first_name  as guest_first_name,
                  g.last_name   as guest_last_name,
                  g.vip         as guest_vip,
                  g.language,
                  greatest(1, round(
                    extract(epoch from (r.check_out_at - r.check_in_at)) / 86400
                  )::int)       as nights,
                  r.check_in_at,
                  r.check_out_at,
                  r.rate_cents,
                  null::float   as gss
                from ops.reservations r
                join ops.guests g on g.id = r.guest_id
                where r.room_id = :room_id
                  and r.org_id  = :org_id
                  and r.status  in ('checked_in', 'checked_out')
                order by r.check_in_at desc
                limit :limit offset :offset
                """
            ),
            {
                "room_id": str(room_id),
                "org_id": str(principal.org_id),
                "limit": limit,
                "offset": offset,
            },
        )
    ).mappings().all()

    return RoomStayHistory(items=[dict(r) for r in rows], total=int(total))
