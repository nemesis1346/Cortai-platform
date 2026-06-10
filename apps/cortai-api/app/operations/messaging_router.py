from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import text

from app.db import SessionDep
from app.operations.messaging_schemas import (
    GuestMessageList,
    GuestMessageRead,
    GuestMessageThreadList,
    GuestMessageThreadRead,
)
from app.operations.rbac import OperationsPrincipalDep

router = APIRouter(prefix="/messaging", tags=["operations-messaging"])


@router.get("/threads", response_model=GuestMessageThreadList)
async def list_message_threads(
    principal: OperationsPrincipalDep,
    session: SessionDep,
    guest: str | None = Query(default=None),
    channel: str | None = Query(default=None),
    status: str | None = Query(default=None),
) -> GuestMessageThreadList:
    filters = ["t.org_id = :org_id"]
    params: dict[str, object] = {"org_id": str(principal.org_id)}

    if channel is not None and str(channel).strip():
        filters.append("t.channel = :channel")
        params["channel"] = str(channel).strip()
    if status is not None and str(status).strip():
        filters.append("t.status = :status")
        params["status"] = str(status).strip()
    if guest is not None and str(guest).strip():
        # Best-effort name search. Keep simple and indexed enough for now.
        filters.append(
            "(g.first_name ilike :guest or g.last_name ilike :guest or (g.first_name || ' ' || g.last_name) ilike :guest)"
        )
        params["guest"] = f"%{str(guest).strip()}%"

    where = " and ".join(filters)
    rows = (
        await session.execute(
            text(
                f"""
                select
                  t.id, t.org_id, t.property_id,
                  t.thread_id, t.guest_id,
                  g.first_name as guest_first_name, g.last_name as guest_last_name,
                  t.channel, t.status, t.assigned_to_user_id,
                  t.unread_count, t.last_message_at,
                  t.created_at, t.updated_at
                from ops.guest_message_threads t
                join ops.guests g on g.id = t.guest_id and g.org_id = t.org_id
                where {where}
                order by t.last_message_at desc nulls last, t.updated_at desc, t.id asc
                """  # noqa: S608
            ),
            params,
        )
    ).mappings().all()
    return GuestMessageThreadList(items=[GuestMessageThreadRead(**dict(r)) for r in rows])


@router.get("/threads/{thread_pk}/messages", response_model=GuestMessageList)
async def list_thread_messages(
    thread_pk: uuid.UUID,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    limit: int = Query(default=200, ge=1, le=500),
) -> GuestMessageList:
    # Ensure the thread exists in this org (RLS-scoped) and fetch its thread_id.
    thread_id = await session.scalar(
        text(
            """
            select thread_id
            from ops.guest_message_threads
            where id = :id and org_id = :org_id
            """
        ),
        {"id": str(thread_pk), "org_id": str(principal.org_id)},
    )
    if thread_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")

    rows = (
        await session.execute(
            text(
                """
                select
                  id, org_id, thread_id, channel, direction, guest_id,
                  body, status, sent_at,
                  created_at, updated_at
                from ops.guest_messages
                where org_id = :org_id and thread_id = :thread_id
                order by sent_at asc, id asc
                limit :limit
                """
            ),
            {"org_id": str(principal.org_id), "thread_id": str(thread_id), "limit": limit},
        )
    ).mappings().all()
    return GuestMessageList(items=[GuestMessageRead(**dict(r)) for r in rows])

