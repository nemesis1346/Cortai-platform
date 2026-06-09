from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query, Request, status
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.bridges import iot_client
from app.db import SessionDep

router = APIRouter(prefix="/hvac", tags=["operations-hvac"])


@router.get("/rooms")
async def list_hvac_rooms(
    request: Request,
    principal: PrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID = Query(...),
) -> Any:
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    return await iot_client.get_hvac_rooms(request)


@router.post("/rooms/{room_id}/control")
async def control_hvac_room(
    room_id: uuid.UUID,
    request: Request,
    principal: PrincipalDep,
    session: SessionDep,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> Any:
    # Validate room belongs to org (RLS scoped).
    exists = await session.scalar(
        text("select 1 from ops.rooms where id = :id and org_id = :org_id"),
        {"id": str(room_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    allowed = {"target_temp_c", "mode", "fan_speed"}
    filtered = {k: v for k, v in payload.items() if k in allowed and v is not None}
    return await iot_client.post_hvac_room_control(request=request, room_id=room_id, payload=filtered)

