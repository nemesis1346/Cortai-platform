from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import text

from app.bridges import iot_client
from app.db import SessionDep
from app.i18n import LocaleDep, http_err
from app.operations.rbac import OperationsPrincipalDep

router = APIRouter(prefix="/pool", tags=["operations-pool"])


@router.get("/status")
async def get_pool_spa_status(
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

    return await iot_client.get_pool_spa_status(request)


@router.get("/capacity")
async def get_pool_capacity(
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

    return await iot_client.get_pool_capacity(request)

