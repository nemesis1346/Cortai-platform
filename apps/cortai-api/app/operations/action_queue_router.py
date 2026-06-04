from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Query, status
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep
from app.operations.action_queue_schemas import (
    ActionQueueCreate,
    ActionQueueList,
    ActionQueueItem,
    ActionQueueSeverity,
    ActionQueueStatus,
    ActionQueueType,
)

router = APIRouter(prefix="/action-queue", tags=["operations-action-queue"])


def _encode_cursor(*, created_at: datetime, id: uuid.UUID) -> str:
    payload = {"created_at": created_at.isoformat(), "id": str(id)}
    return base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8").rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID] | None:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
        payload = json.loads(raw)
        created_at = datetime.fromisoformat(str(payload["created_at"]).replace("Z", "+00:00"))
        item_id = uuid.UUID(str(payload["id"]))
        return created_at, item_id
    except Exception:  # noqa: BLE001
        return None


@router.get("", response_model=ActionQueueList)
async def list_action_queue(
    principal: PrincipalDep,
    session: SessionDep,
    status: ActionQueueStatus | None = None,
    type: ActionQueueType | None = None,  # noqa: A002
    room: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = None,
) -> ActionQueueList:
    filters = ["org_id = :org_id"]
    params: dict[str, object] = {"org_id": str(principal.org_id), "limit": limit}

    if status is not None:
        filters.append("status = :status")
        params["status"] = status.value
    if type is not None:
        filters.append("type = :type")
        params["type"] = type.value
    if room is not None:
        filters.append("room_id = :room_id")
        params["room_id"] = str(room)

    if cursor is not None:
        decoded = _decode_cursor(cursor)
        if decoded is not None:
            (cursor_created_at, cursor_id) = decoded
            filters.append("(created_at, id) < (:cursor_created_at, :cursor_id)")
            params["cursor_created_at"] = cursor_created_at
            params["cursor_id"] = str(cursor_id)

    where = " and ".join(filters)
    rows = (
        await session.execute(
            text(
                f"""
                select
                  id, org_id, type, source, room_id, guest_id, title,
                  status, severity, assigned_to_user_id, sla_due_at, completed_at, parent_incident_id,
                  created_at, updated_at
                from ops.action_queue
                where {where}
                order by created_at desc, id desc
                limit :limit
                """  # noqa: S608
            ),
            params,
        )
    ).mappings().all()

    items = [dict(r) for r in rows]
    next_cursor: str | None = None
    if len(items) == limit:
        last = items[-1]
        next_cursor = _encode_cursor(created_at=last["created_at"], id=last["id"])

    return ActionQueueList(items=items, next_cursor=next_cursor)


@router.post("", response_model=ActionQueueItem, status_code=status.HTTP_201_CREATED)
async def create_action_queue_item(
    payload: ActionQueueCreate,
    principal: PrincipalDep,
    session: SessionDep,
) -> ActionQueueItem:
    now = datetime.now()
    item_id = uuid.uuid4()
    row = (
        await session.execute(
            text(
                """
                insert into ops.action_queue (
                  id, org_id, type, source, room_id, guest_id, title,
                  status, severity, assigned_to_user_id, sla_due_at, completed_at, parent_incident_id,
                  created_at, updated_at
                )
                values (
                  :id, :org_id, :type, :source, :room_id, :guest_id, :title,
                  :status, :severity, :assigned_to_user_id, :sla_due_at, null, :parent_incident_id,
                  :created_at, :updated_at
                )
                returning
                  id, org_id, type, source, room_id, guest_id, title,
                  status, severity, assigned_to_user_id, sla_due_at, completed_at, parent_incident_id,
                  created_at, updated_at
                """
            ),
            {
                "id": str(item_id),
                "org_id": str(principal.org_id),
                "type": payload.type.value,
                "source": payload.source,
                "room_id": str(payload.room_id) if payload.room_id else None,
                "guest_id": str(payload.guest_id) if payload.guest_id else None,
                "title": payload.title,
                "status": payload.status.value,
                "severity": payload.severity.value,
                "assigned_to_user_id": (
                    str(payload.assigned_to_user_id) if payload.assigned_to_user_id else None
                ),
                "sla_due_at": payload.sla_due_at,
                "parent_incident_id": (
                    str(payload.parent_incident_id) if payload.parent_incident_id else None
                ),
                "created_at": now,
                "updated_at": now,
            },
        )
    ).mappings().one()
    await session.commit()
    return ActionQueueItem(**dict(row))

