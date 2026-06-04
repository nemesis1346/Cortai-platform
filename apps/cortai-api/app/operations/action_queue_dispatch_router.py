from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep

router = APIRouter(prefix="/action-queue", tags=["operations-action-queue"])


@router.post("/{item_id}/dispatch")
async def dispatch_action_queue_item(
    item_id: uuid.UUID,
    principal: PrincipalDep,
    session: SessionDep,
) -> dict[str, str | bool]:
    """
    Urgent-only dispatch: emits a NOTIFY event for live subscribers.

    NOTE: ops.action_queue currently has no property_id. We attach a best-effort property_id
    (first property in org) so property-scoped websocket subscribers can receive the event.
    """
    row = (
        await session.execute(
            text(
                """
                select id, org_id, type, source, room_id, guest_id, title, status, severity
                from ops.action_queue
                where id = :id and org_id = :org_id
                """
            ),
            {"id": str(item_id), "org_id": str(principal.org_id)},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Action queue item not found")

    is_urgent = str(row["status"]) == "urgent" or str(row["severity"]) == "urgent"
    if not is_urgent:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only urgent action queue items can be dispatched",
        )

    # Best-effort property id for websocket routing.
    property_id = await session.scalar(
        text("select id from properties where org_id = :org_id order by created_at asc limit 1"),
        {"org_id": str(principal.org_id)},
    )

    now = datetime.now(UTC)
    # Touch row (idempotent) to capture a dispatch "activity" without schema changes.
    await session.execute(
        text(
            """
            update ops.action_queue
            set status = 'urgent',
                updated_at = now()
            where id = :id and org_id = :org_id
            """
        ),
        {"id": str(item_id), "org_id": str(principal.org_id)},
    )

    event = {
        "type": "action_queue.dispatched",
        "org_id": str(principal.org_id),
        "property_id": str(property_id) if property_id else None,
        "action_queue_id": str(row["id"]),
        "room_id": str(row["room_id"]) if row["room_id"] else None,
        "guest_id": str(row["guest_id"]) if row["guest_id"] else None,
        "title": row["title"],
        "status": "urgent",
        "severity": row["severity"],
        "source": row["source"],
        "_server_published_at": now.isoformat(),
        "_server_published_at_ms": int(now.timestamp() * 1000),
    }
    await session.execute(
        text("select pg_notify('cortai_live', :payload)"),
        {"payload": json.dumps(event)},
    )

    await session.commit()
    return {"ok": True, "id": str(item_id)}

