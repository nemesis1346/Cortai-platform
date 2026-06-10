from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep
from app.live.publisher import publish_live_event
from app.operations.rooms_schemas import RoomListItem, RoomStatus, RoomUpdate

router = APIRouter(prefix="/rooms", tags=["operations-rooms"])


@router.patch("/{room_id}", response_model=RoomListItem)
async def patch_room(
    room_id: uuid.UUID,
    payload: RoomUpdate,
    principal: PrincipalDep,
    session: SessionDep,
) -> RoomListItem:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    sets: list[str] = []
    params: dict[str, object] = {"id": str(room_id), "org_id": str(principal.org_id)}

    if "status" in data:
        st: RoomStatus | None = data.get("status")
        if st is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="status cannot be null")
        if st not in {RoomStatus.OUT_OF_ORDER, RoomStatus.INSPECTED}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="status can only be set to out_of_order or inspected",
            )
        sets.append("status = :status")
        params["status"] = st.value

    sets.append("updated_at = now()")

    room_row = (
        await session.execute(
            text(
                f"""
                update ops.rooms
                set {", ".join(sets)}
                where id = :id and org_id = :org_id
                returning
                  id, org_id, property_id,
                  room_number, floor, type, status,
                  current_reservation_id, last_service_at, vip,
                  created_at, updated_at
                """  # noqa: S608
            ),
            params,
        )
    ).mappings().first()

    if room_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    # Optional attendant reassignment (today). If no assignment exists today, create one.
    if "attendant_user_id" in data:
        attendant_user_id = data.get("attendant_user_id")
        if attendant_user_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="attendant_user_id cannot be null"
            )

        now = datetime.now(UTC)
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)

        updated = await session.execute(
            text(
                """
                update ops.housekeeping_assignments
                set attendant_user_id = :attendant_user_id, updated_at = now()
                where org_id = :org_id
                  and property_id = :property_id
                  and room_id = :room_id
                  and created_at >= :sod and created_at < (:sod + interval '1 day')
                returning id
                """
            ),
            {
                "org_id": str(principal.org_id),
                "property_id": str(room_row["property_id"]),
                "room_id": str(room_id),
                "attendant_user_id": str(attendant_user_id),
                "sod": start_of_day,
            },
        )
        any_row = updated.mappings().first()
        if any_row is None:
            await session.execute(
                text(
                    """
                    insert into ops.housekeeping_assignments (
                      id, org_id, property_id, attendant_user_id, room_id, status, created_at, updated_at
                    )
                    values (
                      :id, :org_id, :property_id, :attendant_user_id, :room_id, 'queued', now(), now()
                    )
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "org_id": str(principal.org_id),
                    "property_id": str(room_row["property_id"]),
                    "attendant_user_id": str(attendant_user_id),
                    "room_id": str(room_id),
                },
            )

    now = datetime.now(UTC)
    event = {
        "type": "room.updated",
        "org_id": str(principal.org_id),
        "property_id": str(room_row["property_id"]),
        "room": dict(room_row),
        "_server_published_at": now.isoformat(),
        "_server_published_at_ms": int(now.timestamp() * 1000),
    }
    await publish_live_event(session, event)
    await session.commit()
    return RoomListItem(**dict(room_row))

