from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import text

from app.bridges import iot_client
from app.db import SessionDep
from app.operations.rbac import OperationsPrincipalDep

router = APIRouter(prefix="/iot", tags=["operations-iot"])


@router.get("/sensors")
async def list_iot_sensors(
    request: Request,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID = Query(...),
) -> Any:
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    return await iot_client.get_sensors(request)


@router.get("/sensors/{device_id}/history")
async def get_iot_sensor_history(
    device_id: str,
    request: Request,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID = Query(...),
    type: str | None = Query(default=None),  # noqa: A002
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),  # noqa: A002
) -> Any:
    # Keep signature aligned with requested contract; pass through to bridge as query params.
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    # Passthrough query params already include from/to/type when provided; ensure alias from_ is forwarded.
    params = dict(request.query_params)
    if from_ is not None:
        params["from"] = from_
    if type is not None:
        params["type"] = type
    if to is not None:
        params["to"] = to

    # Bridge contract uses devices/{device_id}/readings.
    return await iot_client.get_device_readings(request, device_id=device_id, params_override=params)

