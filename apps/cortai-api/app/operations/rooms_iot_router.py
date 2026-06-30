from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import text

from app.bridges import iot_client
from app.db import SessionDep
from app.i18n import LocaleDep, http_err
from app.operations.rbac import OperationsPrincipalDep

router = APIRouter(prefix="/rooms", tags=["operations-rooms"])


@router.get("/{room_id}/iot")
async def get_room_iot(
    room_id: uuid.UUID,
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

    return await iot_client.get_room_iot(request=request, room_id=room_id)

