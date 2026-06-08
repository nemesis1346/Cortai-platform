from __future__ import annotations

import uuid

from fastapi import APIRouter, Query
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep
from app.operations.rooms_schemas import RoomList, RoomStatus

router = APIRouter(prefix="/rooms", tags=["operations-rooms"])


@router.get("", response_model=RoomList)
async def list_rooms(
    principal: PrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID = Query(...),
    floor: int | None = None,
    status: RoomStatus | None = None,
    type: str | None = None,  # noqa: A002
    search: str | None = None,
) -> RoomList:
    filters = ["org_id = :org_id", "property_id = :property_id"]
    params: dict[str, object] = {"org_id": str(principal.org_id), "property_id": str(property_id)}

    if floor is not None:
        filters.append("floor = :floor")
        params["floor"] = floor
    if status is not None:
        filters.append("status = :status")
        params["status"] = status.value
    if type:
        filters.append("type = :type")
        params["type"] = type.strip()
    if search:
        filters.append("room_number ilike :search")
        params["search"] = f"%{search.strip()}%"

    where = " and ".join(filters)
    rows = (
        await session.execute(
            text(
                f"""
                select
                  id, org_id, property_id,
                  room_number, floor, type, status,
                  current_reservation_id, last_service_at, vip,
                  created_at, updated_at
                from ops.rooms
                where {where}
                order by floor asc nulls last, room_number asc
                """  # noqa: S608
            ),
            params,
        )
    ).mappings().all()

    return RoomList(items=[dict(r) for r in rows])

