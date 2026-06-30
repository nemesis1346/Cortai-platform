from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text

from app.db import SessionDep
from app.i18n import LocaleDep, http_err
from app.live.publisher import publish_live_event
from app.operations.rbac import OperationsPrincipalDep

router = APIRouter(prefix="/action-queue", tags=["operations-action-queue"])


@router.post("/{item_id}/dispatch")
async def dispatch_action_queue_item(
    item_id: uuid.UUID,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
) -> dict[str, str | bool]:
    """
    Urgent-only dispatch: emits a NOTIFY event for live subscribers.

    NOTE: dispatch emits a NOTIFY event for live subscribers.
    """
    row = (
        await session.execute(
            text(
                """
                select id, org_id, property_id, type, source, room_id, guest_id, title, status, severity
                from ops.action_queue
                where id = :id and org_id = :org_id
                """
            ),
            {"id": str(item_id), "org_id": str(principal.org_id)},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.action_queue.not_found", locale))

    is_urgent = str(row["status"]) == "urgent" or str(row["severity"]) == "urgent"
    if not is_urgent:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=http_err("operations.action_queue.only_urgent", locale),
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
        "property_id": str(row["property_id"]),
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
    await publish_live_event(session, event)

    await session.commit()
    return {"ok": True, "id": str(item_id)}

