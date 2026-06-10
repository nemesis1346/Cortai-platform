from __future__ import annotations

import uuid

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import text

from app.db import SessionDep
from app.live.publisher import publish_live_event
from app.operations.messaging_dispatch import dispatch_outbound_message
from app.operations.messaging_schemas import (
    GuestMessageList,
    GuestMessageRead,
    GuestMessageSendRequest,
    GuestMessageSendResponse,
    GuestMessageTemplateCreate,
    GuestMessageTemplateList,
    GuestMessageTemplateRead,
    GuestMessageTemplateUpdate,
    GuestMessageThreadAssignRequest,
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
                  language,
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


def _infer_language(*, request: Request, explicit: str | None) -> str:
    if explicit and explicit.strip():
        return explicit.strip().lower()
    header = str(request.headers.get("accept-language") or "").strip().lower()
    if header.startswith("fr"):
        return "fr"
    return "en"


DispatchDep = Depends(lambda: dispatch_outbound_message)


@router.post("/threads/{thread_pk}/messages", response_model=GuestMessageSendResponse, status_code=201)
async def send_thread_message(
    thread_pk: uuid.UUID,
    payload: GuestMessageSendRequest,
    request: Request,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    dispatch=DispatchDep,  # type: ignore[assignment]
) -> GuestMessageSendResponse:
    # Ensure the thread exists and fetch stable identifiers.
    thread_row = (
        await session.execute(
            text(
                """
                select id, thread_id, guest_id, property_id, channel
                from ops.guest_message_threads
                where id = :id and org_id = :org_id
                """
            ),
            {"id": str(thread_pk), "org_id": str(principal.org_id)},
        )
    ).mappings().first()
    if thread_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")

    thread_id = str(thread_row["thread_id"])
    guest_id = str(thread_row["guest_id"])
    property_id = str(thread_row["property_id"])
    channel = str(thread_row["channel"])

    language = _infer_language(request=request, explicit=(payload.language.value if payload.language else None))
    now = datetime.now(UTC)
    message_id = str(uuid.uuid4())

    # Persist message first for auditability/debugging; dispatch is external.
    row = (
        await session.execute(
            text(
                """
                insert into ops.guest_messages (
                  id, org_id, thread_id, channel, direction, guest_id, body, status, sent_at, language,
                  created_at, updated_at
                )
                values (
                  :id, :org_id, :thread_id, :channel, 'out', :guest_id, :body, null, :sent_at, :language,
                  :now, :now
                )
                returning
                  id, org_id, thread_id, channel, direction, guest_id, body, status, sent_at, language,
                  created_at, updated_at
                """
            ),
            {
                "id": message_id,
                "org_id": str(principal.org_id),
                "thread_id": thread_id,
                "channel": channel,
                "guest_id": guest_id,
                "body": payload.body,
                "sent_at": now,
                "language": language,
                "now": now,
            },
        )
    ).mappings().one()

    # Update thread last_message_at (keep unread_count untouched for outbound).
    await session.execute(
        text(
            """
            update ops.guest_message_threads
            set last_message_at = :now
            where id = :id and org_id = :org_id
            """
        ),
        {"id": str(thread_pk), "org_id": str(principal.org_id), "now": now},
    )

    # Call internal dispatch (provided by user). Forward JWT cookie via request headers.
    await dispatch(request=request, payload={"thread_id": thread_id, "message_id": message_id, "body": payload.body})

    # Emit a replayable live event.
    await publish_live_event(
        session,
        {
            "type": "message.sent",
            "org_id": str(principal.org_id),
            "property_id": property_id,
            "thread_id": thread_id,
            "message_id": message_id,
            "channel": channel,
            "language": language,
            "direction": "out",
        },
    )

    await session.commit()
    return GuestMessageSendResponse(message=GuestMessageRead(**dict(row)))


@router.get("/templates", response_model=GuestMessageTemplateList)
async def list_message_templates(
    principal: OperationsPrincipalDep,
    session: SessionDep,
    language: str | None = Query(default=None),
    name: str | None = Query(default=None),
) -> GuestMessageTemplateList:
    filters = ["org_id = :org_id"]
    params: dict[str, object] = {"org_id": str(principal.org_id)}
    if language is not None and str(language).strip():
        filters.append("language = :language")
        params["language"] = str(language).strip().lower()
    if name is not None and str(name).strip():
        filters.append("name ilike :name")
        params["name"] = f"%{str(name).strip()}%"
    where = " and ".join(filters)

    rows = (
        await session.execute(
            text(
                f"""
                select
                  id, org_id, name, language, body_template, variables,
                  created_at, updated_at
                from ops.guest_message_templates
                where {where}
                order by name asc, language asc, id asc
                """  # noqa: S608
            ),
            params,
        )
    ).mappings().all()
    return GuestMessageTemplateList(items=[GuestMessageTemplateRead(**dict(r)) for r in rows])


@router.post("/templates", response_model=GuestMessageTemplateRead, status_code=status.HTTP_201_CREATED)
async def create_message_template(
    payload: GuestMessageTemplateCreate,
    principal: OperationsPrincipalDep,
    session: SessionDep,
) -> GuestMessageTemplateRead:
    row = (
        await session.execute(
            text(
                """
                insert into ops.guest_message_templates (
                  id, org_id, name, language, body_template, variables,
                  created_at, updated_at
                )
                values (
                  gen_random_uuid(), :org_id, :name, :language, :body_template, :variables,
                  now(), now()
                )
                returning
                  id, org_id, name, language, body_template, variables,
                  created_at, updated_at
                """
            ),
            {
                "org_id": str(principal.org_id),
                "name": payload.name,
                "language": payload.language.value,
                "body_template": payload.body_template,
                "variables": payload.variables,
            },
        )
    ).mappings().one()
    await session.commit()
    return GuestMessageTemplateRead(**dict(row))


@router.patch("/templates/{template_id}", response_model=GuestMessageTemplateRead)
async def update_message_template(
    template_id: uuid.UUID,
    payload: GuestMessageTemplateUpdate,
    principal: OperationsPrincipalDep,
    session: SessionDep,
) -> GuestMessageTemplateRead:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    sets: list[str] = []
    params: dict[str, object] = {"id": str(template_id), "org_id": str(principal.org_id)}
    if "name" in data:
        sets.append("name = :name")
        params["name"] = data["name"]
    if "language" in data and data["language"] is not None:
        sets.append("language = :language")
        params["language"] = data["language"].value
    if "body_template" in data:
        sets.append("body_template = :body_template")
        params["body_template"] = data["body_template"]
    if "variables" in data:
        sets.append("variables = :variables")
        params["variables"] = data["variables"]

    row = (
        await session.execute(
            text(
                f"""
                update ops.guest_message_templates
                set {", ".join(sets)}
                where id = :id and org_id = :org_id
                returning
                  id, org_id, name, language, body_template, variables,
                  created_at, updated_at
                """  # noqa: S608
            ),
            params,
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    await session.commit()
    return GuestMessageTemplateRead(**dict(row))


@router.post("/threads/{thread_pk}/assign", response_model=GuestMessageThreadRead)
async def assign_message_thread(
    thread_pk: uuid.UUID,
    payload: GuestMessageThreadAssignRequest,
    principal: OperationsPrincipalDep,
    session: SessionDep,
) -> GuestMessageThreadRead:
    # Validate assignee exists in this org (avoid FK 500s).
    if payload.assigned_to_user_id is not None:
        exists = await session.scalar(
            text("select 1 from users where id = :id and org_id = :org_id"),
            {"id": str(payload.assigned_to_user_id), "org_id": str(principal.org_id)},
        )
        if exists is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignee user not found")

    row = (
        await session.execute(
            text(
                """
                update ops.guest_message_threads
                set assigned_to_user_id = :assigned_to_user_id
                where id = :id and org_id = :org_id
                returning
                  id, org_id, property_id,
                  thread_id, guest_id,
                  channel, status, assigned_to_user_id,
                  unread_count, last_message_at,
                  created_at, updated_at
                """
            ),
            {
                "id": str(thread_pk),
                "org_id": str(principal.org_id),
                "assigned_to_user_id": str(payload.assigned_to_user_id) if payload.assigned_to_user_id else None,
            },
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")

    # Emit replayable event.
    await publish_live_event(
        session,
        {
            "type": "message.thread.assigned",
            "org_id": str(principal.org_id),
            "property_id": str(row["property_id"]),
            "thread_id": str(row["thread_id"]),
            "thread_pk": str(row["id"]),
            "assigned_to_user_id": str(payload.assigned_to_user_id) if payload.assigned_to_user_id else None,
        },
    )

    await session.commit()
    return GuestMessageThreadRead(**dict(row))

