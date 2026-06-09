from __future__ import annotations

import uuid

from fastapi import APIRouter, Query
from fastapi.encoders import jsonable_encoder
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep
from app.operations.guest_services_schemas import (
    GuestServiceRequestCreate,
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


@router.post("", status_code=201)
async def create_guest_service_request(
    payload: GuestServiceRequestCreate,
    principal: PrincipalDep,
    session: SessionDep,
) -> dict:
    """
    Create a guest service request and enqueue it in ops.action_queue.
    """
    import json
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    req_id = uuid.uuid4()

    row = (
        await session.execute(
            text(
                """
                insert into ops.guest_service_requests (
                  id, org_id, property_id, room_id, guest_id,
                  type, status, note, assigned_to_user_id, completed_at,
                  created_at, updated_at
                )
                values (
                  :id, :org_id, :property_id, :room_id, :guest_id,
                  :type, 'pending', :note, null, null,
                  :now, :now
                )
                returning
                  id, org_id, property_id, room_id, guest_id,
                  type, status, note, assigned_to_user_id, completed_at,
                  created_at, updated_at
                """
            ),
            {
                "id": str(req_id),
                "org_id": str(principal.org_id),
                "property_id": str(payload.property_id),
                "room_id": str(payload.room_id) if payload.room_id else None,
                "guest_id": str(payload.guest_id) if payload.guest_id else None,
                "type": payload.type.value,
                "note": payload.note,
                "now": now,
            },
        )
    ).mappings().one()

    # Mirror into action queue so Command Center updates in realtime.
    aq_id = uuid.uuid4()
    aq_row = (
        await session.execute(
            text(
                """
                insert into ops.action_queue (
                  id, org_id, property_id, type, source, room_id, guest_id, title,
                  status, severity, assigned_to_user_id, sla_due_at, completed_at, parent_incident_id,
                  created_at, updated_at
                )
                values (
                  :id, :org_id, :property_id, 'request', 'guest_services', :room_id, :guest_id, :title,
                  'pending', 'low', null, null, null, null,
                  :now, :now
                )
                returning
                  id, org_id, property_id, type, source, room_id, guest_id, title,
                  status, severity, assigned_to_user_id, sla_due_at, completed_at, parent_incident_id,
                  created_at, updated_at
                """
            ),
            {
                "id": str(aq_id),
                "org_id": str(principal.org_id),
                "property_id": str(payload.property_id),
                "room_id": str(payload.room_id) if payload.room_id else None,
                "guest_id": str(payload.guest_id) if payload.guest_id else None,
                "title": f"Guest service: {payload.type.value}",
                "now": now,
            },
        )
    ).mappings().one()

    event = {
        "type": "action_queue.created",
        "org_id": str(principal.org_id),
        "property_id": str(payload.property_id),
        "item": dict(aq_row),
        "_server_published_at": now.isoformat(),
        "_server_published_at_ms": int(now.timestamp() * 1000),
    }
    await session.execute(
        text("select pg_notify('cortai_live', :payload)"),
        {"payload": json.dumps(jsonable_encoder(event))},
    )

    await session.commit()
    return {"ok": True, "request": dict(row), "action_queue_item_id": str(aq_id)}

