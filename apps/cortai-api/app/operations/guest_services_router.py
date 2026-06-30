from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import text

from app.db import SessionDep
from app.i18n import LocaleDep, http_err
from app.operations.guest_services_schemas import (
    GuestServiceRequestCreate,
    GuestServiceRequestList,
    GuestServiceRequestUpdate,
    GuestServiceStatus,
    GuestServiceType,
)
from app.operations.rbac import OperationsPrincipalDep

router = APIRouter(prefix="/guest-services", tags=["operations-guest-services"])


@router.get("", response_model=GuestServiceRequestList)
async def list_guest_services(
    principal: OperationsPrincipalDep,
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
                  id, org_id, property_id, room_id, guest_id, action_queue_item_id,
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
    principal: OperationsPrincipalDep,
    session: SessionDep,
) -> dict:
    """
    Create a guest service request and enqueue it in ops.action_queue.
    """
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    req_id = uuid.uuid4()

    row = (
        await session.execute(
            text(
                """
                insert into ops.guest_service_requests (
                  id, org_id, property_id, room_id, guest_id, action_queue_item_id,
                  type, status, note, assigned_to_user_id, completed_at,
                  created_at, updated_at
                )
                values (
                  :id, :org_id, :property_id, :room_id, :guest_id, :action_queue_item_id,
                  :type, 'pending', :note, null, null,
                  :now, :now
                )
                returning
                  id, org_id, property_id, room_id, guest_id, action_queue_item_id,
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
                "action_queue_item_id": None,
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

    # Backfill request link to AQ item.
    row = (
        await session.execute(
            text(
                """
                update ops.guest_service_requests
                set action_queue_item_id = :aq_id,
                    updated_at = now()
                where id = :id and org_id = :org_id
                returning
                  id, org_id, property_id, room_id, guest_id, action_queue_item_id,
                  type, status, note, assigned_to_user_id, completed_at,
                  created_at, updated_at
                """
            ),
            {"id": str(req_id), "org_id": str(principal.org_id), "aq_id": str(aq_id)},
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


@router.patch("/{request_id}", status_code=200)
async def update_guest_service_request(
    request_id: uuid.UUID,
    payload: GuestServiceRequestUpdate,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
) -> dict:
    """
    Assign / complete guest service request and sync the linked action_queue item.
    """
    from datetime import UTC, datetime

    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=http_err("operations.common.no_fields_to_update", locale))

    # Validate assignee exists in this org (avoid FK 500s).
    if "assigned_to_user_id" in data and payload.assigned_to_user_id is not None:
        exists = await session.scalar(
            text("select 1 from users where id = :id and org_id = :org_id"),
            {"id": str(payload.assigned_to_user_id), "org_id": str(principal.org_id)},
        )
        if exists is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.incidents.assignee_not_found", locale))

    # Load request and linked AQ item id.
    req = (
        await session.execute(
            text(
                """
                select id, org_id, property_id, room_id, guest_id, action_queue_item_id, status
                from ops.guest_service_requests
                where id = :id and org_id = :org_id
                """
            ),
            {"id": str(request_id), "org_id": str(principal.org_id)},
        )
    ).mappings().first()
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.guest_services.not_found", locale))

    sets: list[str] = []
    params: dict[str, object] = {"id": str(request_id), "org_id": str(principal.org_id)}

    if payload.status is not None:
        sets.append("status = :status")
        params["status"] = payload.status.value
        if payload.status.value == "completed":
            sets.append("completed_at = now()")
        elif payload.status.value != "completed":
            sets.append("completed_at = null")

    if "assigned_to_user_id" in data:
        sets.append("assigned_to_user_id = :assigned_to_user_id")
        params["assigned_to_user_id"] = str(payload.assigned_to_user_id) if payload.assigned_to_user_id else None

    sets.append("updated_at = now()")

    updated = (
        await session.execute(
            text(
                f"""
                update ops.guest_service_requests
                set {", ".join(sets)}
                where id = :id and org_id = :org_id
                returning
                  id, org_id, property_id, room_id, guest_id, action_queue_item_id,
                  type, status, note, assigned_to_user_id, completed_at,
                  created_at, updated_at
                """  # noqa: S608
            ),
            params,
        )
    ).mappings().one()

    # Sync to action_queue if linked.
    aq_id = updated["action_queue_item_id"]
    if aq_id is not None:
        aq_sets: list[str] = []
        aq_params: dict[str, object] = {"id": str(aq_id), "org_id": str(principal.org_id)}
        if payload.status is not None:
            # Map guest-service status to action_queue.status.
            if payload.status.value == "assigned":
                aq_sets.append("status = 'assigned'")
            elif payload.status.value == "completed":
                aq_sets.append("status = 'completed'")
                aq_sets.append("completed_at = now()")
            elif payload.status.value == "cancelled":
                aq_sets.append("status = 'cancelled'")
                aq_sets.append("completed_at = null")
            else:
                aq_sets.append("status = 'pending'")
                aq_sets.append("completed_at = null")
        if "assigned_to_user_id" in data:
            aq_sets.append("assigned_to_user_id = :assigned_to_user_id")
            aq_params["assigned_to_user_id"] = (
                str(payload.assigned_to_user_id) if payload.assigned_to_user_id else None
            )
        if aq_sets:
            aq_sets.append("updated_at = now()")
            aq_row = (
                await session.execute(
                    text(
                        f"""
                        update ops.action_queue
                        set {", ".join(aq_sets)}
                        where id = :id and org_id = :org_id
                        returning
                          id, org_id, property_id, type, source, room_id, guest_id, title,
                          status, severity, assigned_to_user_id, sla_due_at, completed_at, parent_incident_id,
                          created_at, updated_at
                        """  # noqa: S608
                    ),
                    aq_params,
                )
            ).mappings().first()
            if aq_row is not None:
                now = datetime.now(UTC)
                event_type = "action_queue.updated"
                try:
                    if str(aq_row["status"]) == "completed":
                        event_type = "action_queue.completed"
                except Exception:  # noqa: BLE001
                    pass
                event = {
                    "type": event_type,
                    "org_id": str(principal.org_id),
                    "property_id": str(aq_row["property_id"]),
                    "item": dict(aq_row),
                    "_server_published_at": now.isoformat(),
                    "_server_published_at_ms": int(now.timestamp() * 1000),
                }
                await session.execute(
                    text("select pg_notify('cortai_live', :payload)"),
                    {"payload": json.dumps(jsonable_encoder(event))},
                )

    await session.commit()
    return {"ok": True, "request": dict(updated)}

