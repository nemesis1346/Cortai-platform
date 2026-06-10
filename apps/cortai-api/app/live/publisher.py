from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from fastapi.encoders import jsonable_encoder
from sqlalchemy import text
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession


async def publish_live_event(session: AsyncSession, event: dict[str, Any]) -> dict[str, Any]:
    """
    Persist and notify a live event.

    The persisted sequence is the replay cursor used by WebSocket subscribers.
    """
    now = datetime.now(UTC)
    event_id = str(event.get("event_id") or uuid.uuid4())
    enriched = {
        **event,
        "event_id": event_id,
        "_server_published_at": event.get("_server_published_at") or now.isoformat(),
        "_server_published_at_ms": event.get("_server_published_at_ms") or int(now.timestamp() * 1000),
    }
    safe_event = jsonable_encoder(enriched)
    row = (
        await session.execute(
            text(
                """
                insert into realtime.event_log (
                  id, org_id, property_id, type, payload_json, created_at
                )
                values (
                  :id, :org_id, :property_id, :type, :payload_json, :created_at
                )
                returning sequence
                """
            ).bindparams(sa.bindparam("payload_json", type_=postgresql.JSONB)),
            {
                "id": event_id,
                "org_id": str(safe_event["org_id"]),
                "property_id": str(safe_event["property_id"]) if safe_event.get("property_id") else None,
                "type": str(safe_event["type"]),
                "payload_json": safe_event,
                "created_at": now,
            },
        )
    ).mappings().one()
    safe_event["sequence"] = int(row["sequence"])
    await session.execute(text("select pg_notify('cortai_live', :payload)"), {"payload": json.dumps(safe_event)})
    return safe_event

