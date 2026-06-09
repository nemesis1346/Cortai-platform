from __future__ import annotations

import uuid

from fastapi import APIRouter, Query
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep
from app.operations.guest_services_schemas import (
    GuestServiceRequestList,
    GuestServiceStatus,
    GuestServiceType,
)

router = APIRouter(prefix="/guest-services", tags=["operations-guest-services"])


@router.get("", response_model=GuestServiceRequestList)
async def list_guest_services(
    principal: PrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID = Query(...),
    status: GuestServiceStatus | None = None,
    room: uuid.UUID | None = None,
    type: GuestServiceType | None = None,  # noqa: A002
) -> GuestServiceRequestList:
    filters = ["org_id = :org_id", "property_id = :property_id"]
    params: dict[str, object] = {"org_id": str(principal.org_id), "property_id": str(property_id)}

    if status is not None:
        filters.append("status = :status")
        params["status"] = status.value
    if room is not None:
        filters.append("room_id = :room_id")
        params["room_id"] = str(room)
    if type is not None:
        filters.append("type = :type")
        params["type"] = type.value

    where = " and ".join(filters)
    rows = (
        await session.execute(
            text(
                f"""
                select
                  id, org_id, property_id, room_id, guest_id,
                  type, status, note, assigned_to_user_id, completed_at,
                  created_at, updated_at
                from ops.guest_service_requests
                where {where}
                order by created_at desc, id desc
                """  # noqa: S608
            ),
            params,
        )
    ).mappings().all()

    return GuestServiceRequestList(items=[dict(r) for r in rows])

