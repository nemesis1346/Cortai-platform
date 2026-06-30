from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query, Request, status
from sqlalchemy import text

from app.bridges import iot_client
from app.db import SessionDep
from app.i18n import LocaleDep, http_err
from app.live.publisher import publish_live_event
from app.operations.rbac import OperationsPrincipalDep

router = APIRouter(prefix="/hvac", tags=["operations-hvac"])


@router.get("/rooms")
async def list_hvac_rooms(
    request: Request,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
    property_id: uuid.UUID = Query(...),
) -> Any:
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.common.property_not_found", locale))

    return await iot_client.get_hvac_rooms(request)


@router.post("/rooms/{room_id}/control")
async def control_hvac_room(
    room_id: uuid.UUID,
    request: Request,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
    payload: dict[str, Any] = Body(default_factory=dict),
) -> Any:
    # Fetch property_id (needed for live event) and validate org membership.
    property_id = await session.scalar(
        text("select property_id from ops.rooms where id = :id and org_id = :org_id"),
        {"id": str(room_id), "org_id": str(principal.org_id)},
    )
    if property_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.common.room_not_found", locale))

    allowed = {"target_temp_c", "mode", "fan_speed"}
    filtered = {k: v for k, v in payload.items() if k in allowed and v is not None}
    resp = await iot_client.post_hvac_room_control(
        request=request, room_id=room_id, payload=filtered
    )

    # Publish ACK event so WS subscribers don't need to poll the ACK endpoint.
    await publish_live_event(session, {
        "type": "hvac.command.acked",
        "org_id": str(principal.org_id),
        "property_id": str(property_id),
        "command_id": resp.get("command_id", ""),
        "room_id": str(room_id),
        "accepted": True,
    })
    await session.commit()
    return resp


@router.get("/alerts")
async def list_hvac_alerts(
    request: Request,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
    property_id: uuid.UUID = Query(...),
    since: str | None = Query(default=None),
) -> Any:
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.common.property_not_found", locale))

    # Ensure type=hvac_fault is always applied.
    params = dict(request.query_params)
    params["type"] = "hvac_fault"
    if since is not None:
        params["since"] = since

    return await iot_client.get_edge_events(request, params_override=params)


@router.get("/rooms/{room_id}/commands/{command_id}")
async def get_hvac_room_command_ack(
    room_id: uuid.UUID,
    command_id: str,
    request: Request,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
) -> Any:
    exists = await session.scalar(
        text("select 1 from ops.rooms where id = :id and org_id = :org_id"),
        {"id": str(room_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.common.room_not_found", locale))

    return await iot_client.get_hvac_command_ack(request=request, room_id=room_id, command_id=command_id)
