from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, status
from sqlalchemy import text

from app.db import SessionDep
from app.live.publisher import publish_live_event
from app.operations.action_queue_schemas import ActionQueueCreate, ActionQueueItem
from app.operations.rbac import OperationsPrincipalDep

router = APIRouter(prefix="/action-queue", tags=["operations-action-queue"])


@router.post("", response_model=ActionQueueItem, status_code=status.HTTP_201_CREATED)
async def create_action_queue_item(
    payload: ActionQueueCreate,
    principal: OperationsPrincipalDep,
    session: SessionDep,
) -> ActionQueueItem:
    now = datetime.now(UTC)
    item_id = uuid.uuid4()
    row = (
        await session.execute(
            text(
                """
                insert into ops.action_queue (
                  id, org_id, property_id, type, source, room_id, guest_id, title,
                  status, severity, assigned_to_user_id, sla_due_at, completed_at, parent_incident_id,
                  created_at, updated_at
                )
                values (
                  :id, :org_id, :property_id, :type, :source, :room_id, :guest_id, :title,
                  :status, :severity, :assigned_to_user_id, :sla_due_at, null, :parent_incident_id,
                  :created_at, :updated_at
                )
                returning
                  id, org_id, property_id, type, source, room_id, guest_id, title,
                  status, severity, assigned_to_user_id, sla_due_at, completed_at, parent_incident_id,
                  created_at, updated_at
                """
            ),
            {
                "id": str(item_id),
                "org_id": str(principal.org_id),
                "property_id": str(payload.property_id),
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
    event = {
        "type": "action_queue.created",
        "org_id": str(principal.org_id),
        "property_id": str(payload.property_id),
        "item": dict(row),
        "_server_published_at": now.isoformat(),
        "_server_published_at_ms": int(now.timestamp() * 1000),
    }
    await publish_live_event(session, event)
    await session.commit()
    return ActionQueueItem(**dict(row))

