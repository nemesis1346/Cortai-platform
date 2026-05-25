from __future__ import annotations

import json
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from fastapi import Request, Response
from fastapi.encoders import jsonable_encoder
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware

from app.auth.schemas import Principal
from app.db import SessionLocal, set_current_org
from sqlalchemy.dialects import postgresql
import sqlalchemy as sa


def _client_ip(request: Request) -> str | None:
    # Prefer proxy header when present (common behind Caddy/ELB).
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",", 1)[0].strip() or None
    if request.client:
        return request.client.host
    return None


def _should_audit(request: Request) -> bool:
    if request.method not in {"POST", "PATCH", "DELETE"}:
        return False
    path = request.url.path
    return path.startswith("/api/admin/") or path.startswith("/api/operations/")


async def _best_effort_before_snapshot(
    *, session: AsyncSession, principal: Principal, entity_type: str, entity_id: str | None
) -> dict[str, Any] | None:
    # Keep this intentionally narrow to avoid unexpected load.
    if entity_id is None:
        return None
    if entity_type == "admin_user":
        row = await session.execute(
            text(
                """
                select id, org_id, email, full_name, role, status, created_at, updated_at
                from users
                where id = :id and org_id = :org_id
                """
            ),
            {"id": entity_id, "org_id": str(principal.org_id)},
        )
        m = row.mappings().first()
        return dict(m) if m is not None else None
    if entity_type == "admin_device":
        row = await session.execute(
            text(
                """
                select id, org_id, property_id, device_id, type, capabilities, cert_fingerprint,
                       logical_bindings, last_seen_at, is_offline, offline_since, created_at, updated_at
                from platform.devices
                where id = :id and org_id = :org_id
                """
            ),
            {"id": entity_id, "org_id": str(principal.org_id)},
        )
        m = row.mappings().first()
        return dict(m) if m is not None else None
    if entity_type == "admin_property":
        row = await session.execute(
            text(
                """
                select id, org_id, name, slug, marsha_property_id, address, room_count, status, created_at, updated_at
                from properties
                where id = :id and org_id = :org_id
                """
            ),
            {"id": entity_id, "org_id": str(principal.org_id)},
        )
        m = row.mappings().first()
        return dict(m) if m is not None else None
    if entity_type == "operations_incident":
        row = await session.execute(
            text(
                """
                select id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at
                from operations.incidents
                where id = :id and org_id = :org_id
                """
            ),
            {"id": entity_id, "org_id": str(principal.org_id)},
        )
        m = row.mappings().first()
        return dict(m) if m is not None else None
    return None


def _entity_type_for_path(path: str) -> str:
    # Keep stable identifiers for reporting.
    if path.startswith("/api/admin/users"):
        return "admin_user"
    if path.startswith("/api/admin/devices"):
        return "admin_device"
    if path.startswith("/api/admin/properties"):
        return "admin_property"
    if path.startswith("/api/operations/incidents"):
        return "operations_incident"
    if path.startswith("/api/operations/"):
        return "operations"
    return "unknown"


def _entity_id_from_path(path: str) -> str | None:
    parts = [p for p in path.split("/") if p]
    if len(parts) >= 4 and parts[0] == "api" and parts[1] in {"admin", "operations"}:
        candidate = parts[3]
        # Best effort: only log IDs that look like UUIDs.
        try:
            return str(uuid.UUID(candidate))
        except Exception:  # noqa: BLE001
            return None
    return None


class AuditLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if not _should_audit(request):
            return await call_next(request)

        principal: Principal | None = getattr(request.state, "principal", None)
        if principal is None:
            # Not authenticated.
            return await call_next(request)

        path = request.url.path
        entity_type = _entity_type_for_path(path)
        entity_id = _entity_id_from_path(path)
        before_json: dict[str, Any] | None = None

        # Capture "before" snapshot in its own session to avoid depending on request DI.
        try:
            async with SessionLocal() as snap_session:
                await set_current_org(snap_session, str(principal.org_id))
                before_json = await _best_effort_before_snapshot(
                    session=snap_session,
                    principal=principal,
                    entity_type=entity_type,
                    entity_id=entity_id,
                )
        except Exception:  # noqa: BLE001
            before_json = None

        response = await call_next(request)

        # Only log successful mutations.
        if response.status_code >= 400:
            return response

        after_json: dict[str, Any] | None = None
        try:
            if response.headers.get("content-type", "").lower().startswith("application/json"):
                body = b""
                async for chunk in response.body_iterator:
                    body += chunk
                # Rebuild response with buffered body.
                response = Response(
                    content=body,
                    status_code=response.status_code,
                    headers=dict(response.headers),
                    media_type=response.media_type,
                )
                if body:
                    after_json = json.loads(body.decode("utf-8"))
        except Exception:  # noqa: BLE001
            after_json = None

        action = request.method.lower()
        ip = _client_ip(request)
        user_agent = request.headers.get("user-agent")

        # Ensure JSONB params are serializable (uuid/datetime -> strings).
        safe_before_json = jsonable_encoder(before_json) if before_json is not None else None
        safe_after_json = jsonable_encoder(after_json) if after_json is not None else None

        # Use a dedicated session so audit doesn't depend on request dependencies.
        async with SessionLocal() as session:
            await set_current_org(session, str(principal.org_id))
            stmt = text(
                """
                insert into audit.change_log (
                  id, org_id, user_id, action, entity_type, entity_id,
                  before_json, after_json, ts, ip, user_agent
                )
                values (
                  :id, :org_id, :user_id, :action, :entity_type, :entity_id,
                  :before_json, :after_json, :ts, :ip, :user_agent
                )
                """
            ).bindparams(
                sa.bindparam("before_json", type_=postgresql.JSONB),
                sa.bindparam("after_json", type_=postgresql.JSONB),
            )
            await session.execute(
                stmt,
                {
                    "id": str(uuid.uuid4()),
                    "org_id": str(principal.org_id),
                    "user_id": str(principal.user_id),
                    "action": action,
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                    "before_json": safe_before_json,
                    "after_json": safe_after_json,
                    "ts": datetime.now(UTC),
                    "ip": ip,
                    "user_agent": user_agent,
                },
            )
            await session.commit()

        return response

