from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import SessionDep
from app.live.publisher import publish_live_event

router = APIRouter(prefix="/api/internal/messaging", tags=["internal-messaging"])


class MessagingDispatchRequest(BaseModel):
    thread_id: str = Field(min_length=1, max_length=128)
    message_id: uuid.UUID
    body: str = Field(min_length=1)


async def fake_dispatch_reply(
    *,
    session: AsyncSession,
    thread_id: str,
    outbound_body: str,
) -> dict[str, object]:
    thread = (
        await session.execute(
            text(
                """
                select id, org_id, property_id, thread_id, guest_id, channel
                from ops.guest_message_threads
                where thread_id = :thread_id
                """
            ),
            {"thread_id": thread_id},
        )
    ).mappings().first()
    if thread is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")

    now = datetime.now(UTC)
    inbound_id = str(uuid.uuid4())
    reply_body = f"Fake Twilio reply: received '{outbound_body}'"

    row = (
        await session.execute(
            text(
                """
                insert into ops.guest_messages (
                  id, org_id, thread_id, channel, direction, guest_id, body, status, sent_at, language,
                  created_at, updated_at
                )
                values (
                  :id, :org_id, :thread_id, :channel, 'in', :guest_id, :body, null, :sent_at, 'en',
                  :now, :now
                )
                returning
                  id, org_id, thread_id, channel, direction, guest_id, body, status, sent_at, language,
                  created_at, updated_at
                """
            ),
            {
                "id": inbound_id,
                "org_id": str(thread["org_id"]),
                "thread_id": str(thread["thread_id"]),
                "channel": str(thread["channel"]),
                "guest_id": str(thread["guest_id"]),
                "body": reply_body,
                "sent_at": now,
                "now": now,
            },
        )
    ).mappings().one()

    await session.execute(
        text(
            """
            update ops.guest_message_threads
            set unread_count = unread_count + 1,
                last_message_at = :now
            where id = :id
            """
        ),
        {"id": str(thread["id"]), "now": now},
    )

    await publish_live_event(
        session,
        {
            "type": "message.received",
            "org_id": str(thread["org_id"]),
            "property_id": str(thread["property_id"]),
            "thread_id": str(thread["thread_id"]),
            "message_id": inbound_id,
            "message": dict(row),
        },
    )

    return {"ok": True, "adapter": "fake", "inbound_message_id": inbound_id}


@router.post("/dispatch")
async def dispatch_message(payload: MessagingDispatchRequest, session: SessionDep) -> dict[str, object]:
    """
    Feature-flagged fake dispatch adapter for demo/dev.

    Real Twilio/WhatsApp/SES dispatch is provided externally; this mock path only
    lets the Block 5 demo complete end-to-end when MESSAGING_DISPATCH_MODE=mock.
    """
    if get_settings().messaging_dispatch_mode.lower().strip() != "mock":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    result = await fake_dispatch_reply(session=session, thread_id=payload.thread_id, outbound_body=payload.body)
    await session.commit()
    return result

