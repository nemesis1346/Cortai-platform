from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.bridges import iot_client
from app.db import SessionDep

router = APIRouter(prefix="/fb", tags=["operations-fb"])


@router.get("/breakfast/status")
async def get_breakfast_status(
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

    return await iot_client.get_fb_breakfast_status(request)

