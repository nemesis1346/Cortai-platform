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

