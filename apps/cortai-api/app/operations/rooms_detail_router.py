from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text

from app.db import SessionDep
from app.operations.rbac import OperationsPrincipalDep
from app.operations.rooms_schemas import RoomDetail

router = APIRouter(prefix="/rooms", tags=["operations-rooms"])


@router.get("/{room_id}", response_model=RoomDetail)
async def get_room_detail(
    room_id: uuid.UUID,
    principal: OperationsPrincipalDep,
    session: SessionDep,
) -> RoomDetail:
    room_row = (
        await session.execute(
            text(
                """
                select
                  id, org_id, property_id,
                  room_number, floor, type, status,
                  current_reservation_id, last_service_at, vip,
                  created_at, updated_at
                from ops.rooms
                where id = :id and org_id = :org_id
                """
            ),
            {"id": str(room_id), "org_id": str(principal.org_id)},
        )
    ).mappings().first()
    if room_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    reservation_row = None
    if room_row.get("current_reservation_id"):
        reservation_row = (
            await session.execute(
                text(
                    """
                    select
                      r.id,
                      r.guest_id,
                      r.property_id,
                      r.room_id,
                      r.status,
                      r.check_in_at,
                      r.check_out_at,
                      r.rate_cents,
                      r.group_id,
                      r.source,
                      g.id as guest__id,
                      g.first_name as guest__first_name,
                      g.last_name as guest__last_name,
                      g.vip as guest__vip,
                      g.language as guest__language,
                      g.phone_e164 as guest__phone_e164,
                      g.email as guest__email
                    from ops.reservations r
                    join ops.guests g on g.id = r.guest_id
                    where r.org_id = :org_id
                      and r.id = :reservation_id
                      and r.property_id = :property_id
                    limit 1
                    """
                ),
                {
                    "org_id": str(principal.org_id),
                    "reservation_id": str(room_row["current_reservation_id"]),
                    "property_id": str(room_row["property_id"]),
                },
            )
        ).mappings().first()

    current_reservation = None
    if reservation_row is not None:
        rr = dict(reservation_row)
        guest = {
            "id": rr.pop("guest__id"),
            "first_name": rr.pop("guest__first_name"),
            "last_name": rr.pop("guest__last_name"),
            "vip": rr.pop("guest__vip"),
            "language": rr.pop("guest__language"),
            "phone_e164": rr.pop("guest__phone_e164"),
            "email": rr.pop("guest__email"),
        }
        rr["guest"] = guest
        current_reservation = rr

    incidents = (
        await session.execute(
            text(
                """
                select
                  id, org_id, property_id, severity, status, title, created_at, updated_at
                from ops.action_queue
                where org_id = :org_id
                  and property_id = :property_id
                  and room_id = :room_id
                  and type = 'incident'
                order by created_at desc, id desc
                limit 5
                """
            ),
            {
                "org_id": str(principal.org_id),
                "property_id": str(room_row["property_id"]),
                "room_id": str(room_id),
            },
        )
    ).mappings().all()

    return RoomDetail(
        room=dict(room_row),
        current_reservation=current_reservation,
        recent_incidents=[dict(i) for i in incidents],
    )

