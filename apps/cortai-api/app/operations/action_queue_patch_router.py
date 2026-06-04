from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep
from app.operations.action_queue_schemas import ActionQueueItem
from app.operations.action_queue_update_schemas import ActionQueueUpdate

router = APIRouter(prefix="/action-queue", tags=["operations-action-queue"])


@router.patch("/{item_id}", response_model=ActionQueueItem)
async def update_action_queue_item(
    item_id: uuid.UUID,
    payload: ActionQueueUpdate,
    principal: PrincipalDep,
    session: SessionDep,
) -> ActionQueueItem:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    sets: list[str] = []
    params: dict[str, object] = {"id": str(item_id), "org_id": str(principal.org_id)}

    for k, v in data.items():
        if k in {"status", "severity", "type"} and v is not None:
            sets.append(f"{k} = :{k}")  # noqa: S608
            params[k] = v.value
        elif k in {"assigned_to_user_id", "room_id", "guest_id", "parent_incident_id"}:
            sets.append(f"{k} = :{k}")  # noqa: S608
            params[k] = str(v) if v else None
        else:
            sets.append(f"{k} = :{k}")  # noqa: S608
            params[k] = v

    # When completing, set completed_at automatically unless explicitly set.
    if "status" in data and data.get("status") is not None and data["status"].value == "completed":
        if "completed_at" not in data:
            sets.append("completed_at = now()")
    # If moving away from completed and completed_at wasn't explicitly provided, clear it.
    if "status" in data and data.get("status") is not None and data["status"].value != "completed":
        if "completed_at" not in data:
            sets.append("completed_at = null")

    sets.append("updated_at = now()")

    row = (
        await session.execute(
            text(
                f"""
                update ops.action_queue
                set {", ".join(sets)}
                where id = :id and org_id = :org_id
                returning
                  id, org_id, type, source, room_id, guest_id, title,
                  status, severity, assigned_to_user_id, sla_due_at, completed_at, parent_incident_id,
                  created_at, updated_at
                """  # noqa: S608
            ),
            params,
        )
    ).mappings().first()

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Action queue item not found")

    await session.commit()
    return ActionQueueItem(**dict(row))

