from __future__ import annotations

import asyncio
import inspect
import json
import time
import uuid
from datetime import UTC, datetime
from typing import Any

import asyncpg
import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from sqlalchemy import text

from app.auth.security import decode_token
from app.config import get_settings
from app.db import SessionLocal, set_current_org

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/ws", tags=["live"])


def _token_from_websocket(ws: WebSocket) -> str | None:
    # Prefer cookie auth (matches existing frontend), fallback to ?token= for tools.
    cookie = ws.cookies.get("cortai_access_token")
    if cookie:
        return cookie
    q = ws.query_params.get("token")
    return q


async def _authorize_property(*, org_id: str, property_id: str) -> bool:
    # We currently don't have SQLAlchemy models for properties, so we query directly.
    try:
        property_uuid = uuid.UUID(property_id)
    except ValueError:
        return False

    async with SessionLocal() as session:
        # `set_config(..., true)` is transaction-local; keep the check in the same transaction.
        async with session.begin():
            await set_current_org(session, org_id)
            row = await session.execute(
                text("select 1 from properties where id = :pid"),
                {"pid": property_uuid},
            )
            return row.first() is not None


def _dsn_for_asyncpg(database_url: str) -> str:
    # Our app uses SQLAlchemy async URLs. asyncpg expects a plain postgresql:// DSN.
    if database_url.startswith("postgresql+asyncpg://"):
        return database_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    return database_url


async def _listen_and_forward(
    *,
    ws: WebSocket,
    dsn: str,
    channel: str,
    org_id: str,
    property_id: str | None,
    scope: str,
    stop: asyncio.Event,
) -> None:
    conn = await asyncpg.connect(dsn)
    try:
        queue: asyncio.Queue[str] = asyncio.Queue()

        def _on_notify(_conn: asyncpg.Connection, _pid: int, _chan: str, payload: str) -> None:
            queue.put_nowait(payload)

        # LISTEN cannot be parameterized; use fixed channel name.
        await conn.execute(f'listen "{channel}"')
        maybe = conn.add_listener(channel, _on_notify)
        if inspect.isawaitable(maybe):
            await maybe
        logger.info(
            "live.pg.listen_started",
            channel=channel,
            org_id=org_id,
            property_id=property_id,
            scope=scope,
        )

        while not stop.is_set():
            try:
                payload = await asyncio.wait_for(queue.get(), timeout=1.0)
            except TimeoutError:
                continue

            now = datetime.now(UTC).isoformat()
            try:
                msg = json.loads(payload)
            except json.JSONDecodeError:
                logger.warning("live.pg.bad_payload", channel=channel)
                continue

            msg_org_id = str(msg.get("org_id") or "")
            if msg_org_id != org_id:
                continue

            if scope == "property":
                msg_property_id = str(msg.get("property_id") or "")
                if property_id is None or msg_property_id != property_id:
                    # Other properties may be publishing to the same channel.
                    continue
                logger.info(
                    "live.pg.notify_received", channel=channel, org_id=org_id, property_id=property_id
                )
            else:
                # Org-level alerts subscription: forward only alert-style events.
                if str(msg.get("type") or "") != "device_offline":
                    continue
                logger.info("live.pg.notify_received", channel=channel, org_id=org_id, scope=scope)

            # Attach server timestamps for latency measurement.
            msg["_server_published_at"] = now
            msg["_server_published_at_ms"] = int(time.time() * 1000)
            try:
                await ws.send_json(msg)
                logger.info(
                    "live.ws.forwarded",
                    channel=channel,
                    org_id=org_id,
                    property_id=property_id,
                    scope=scope,
                )
            except WebSocketDisconnect:
                return
    finally:
        try:
            maybe = conn.remove_listener(channel, _on_notify)
            if inspect.isawaitable(maybe):
                await maybe
        except Exception:  # noqa: BLE001
            pass
        try:
            await conn.execute(f'unlisten "{channel}"')
        except Exception:  # noqa: BLE001
            pass
        await conn.close()


@router.websocket("/live")
async def live_socket(ws: WebSocket) -> None:
    await ws.accept()

    token = _token_from_websocket(ws)
    if token is None:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        principal = decode_token(token)
    except Exception:  # noqa: BLE001
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    stop = asyncio.Event()
    task: asyncio.Task[None] | None = None
    settings = get_settings()
    dsn = _dsn_for_asyncpg(settings.database_url)
    channel = "cortai_live"
    subscribed_property_id: str | None = None
    subscribed_scope: str = "property"

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data: dict[str, Any] = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "error": "invalid_json"})
                continue

            if data.get("type") == "ping":
                await ws.send_json({"type": "pong", "t": datetime.now(UTC).isoformat()})
                continue

            if data.get("type") != "subscribe":
                await ws.send_json({"type": "error", "error": "unsupported_message_type"})
                continue

            scope = str(data.get("scope") or "property")
            if scope not in {"property", "org_alerts"}:
                await ws.send_json({"type": "error", "error": "invalid_scope"})
                continue

            property_id = str(data.get("property_id") or "")
            if scope == "property":
                if not property_id:
                    await ws.send_json({"type": "error", "error": "property_id_required"})
                    continue

                allowed = await _authorize_property(
                    org_id=str(principal.org_id), property_id=property_id
                )
                if not allowed:
                    await ws.send_json({"type": "error", "error": "forbidden"})
                    continue

            # One subscription per connection for V1.
            if task is not None:
                stop.set()
                try:
                    await task
                except Exception:  # noqa: BLE001
                    pass
                stop = asyncio.Event()

            subscribed_scope = scope
            subscribed_property_id = property_id if scope == "property" else None
            await ws.send_json(
                {
                    "type": "subscribed",
                    "scope": subscribed_scope,
                    "channel": f"cortai.live.{property_id}" if subscribed_property_id else "cortai.alerts",
                }
            )
            logger.info(
                "live.ws.subscribed",
                org_id=str(principal.org_id),
                property_id=subscribed_property_id,
                scope=subscribed_scope,
            )
            task = asyncio.create_task(
                _listen_and_forward(
                    ws=ws,
                    dsn=dsn,
                    channel=channel,
                    org_id=str(principal.org_id),
                    property_id=subscribed_property_id,
                    scope=subscribed_scope,
                    stop=stop,
                )
            )
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.exception("live.ws.error", error=str(exc))
        try:
            await ws.close(code=status.WS_1011_INTERNAL_ERROR)
        except Exception:  # noqa: BLE001
            pass
    finally:
        if task is not None:
            stop.set()
            try:
                await task
            except Exception:  # noqa: BLE001
                pass

