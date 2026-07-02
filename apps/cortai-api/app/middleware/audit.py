from __future__ import annotations

import json
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from fastapi import Request, Response
from fastapi.encoders import jsonable_encoder
from sqlalchemy import text
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware

from app.auth.schemas import Principal
from app.db import SessionLocal, set_current_org


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


# ---------------------------------------------------------------------------
# Snapshot registry
#
# Maps entity_type → SELECT SQL with :id and :org_id bind params.
# Adding a new auditable entity is one line here.
# ---------------------------------------------------------------------------

_SNAPSHOT_QUERIES: dict[str, str] = {
    # ── admin entities ──────────────────────────────────────────────────────
    "admin_user": (
        "select id, org_id, email, full_name, role, status, created_at, updated_at"
        " from users where id = :id and org_id = :org_id"
    ),
    "admin_device": (
        "select id, org_id, property_id, device_id, type, capabilities, cert_fingerprint,"
        " logical_bindings, last_seen_at, is_offline, offline_since, created_at, updated_at"
        " from platform.devices where id = :id and org_id = :org_id"
    ),
    "admin_property": (
        "select id, org_id, name, slug, marsha_property_id, address, room_count, status,"
        " created_at, updated_at"
        " from properties where id = :id and org_id = :org_id"
    ),
    "admin_form_definition": (
        "select id, org_id, slug, title_en, title_fr, schema_json, ui_hints_json,"
        " version, status, created_at, updated_at, published_at"
        " from platform.form_definitions where id = :id and org_id = :org_id"
    ),
    "operations_form_submission": (
        "select id, org_id, form_definition_id, form_version, submitted_by_user_id,"
        " submitted_by_guest_id, source_property_id, status, created_at, updated_at, submitted_at"
        " from platform.form_submissions where id = :id and org_id = :org_id"
    ),
    # ── ops entities ────────────────────────────────────────────────────────
    "operations_incident": (
        "select id, org_id, property_id, severity, status, title, description,"
        " assigned_to, created_at, resolved_at"
        " from ops.incidents where id = :id and org_id = :org_id"
    ),
    "operations_action_queue": (
        "select id, org_id, type, source, room_id, guest_id, title,"
        " assigned_to_user_id, sla_due_at, completed_at, parent_incident_id, created_at, updated_at"
        " from ops.action_queue where id = :id and org_id = :org_id"
    ),
    "operations_menu_item": (
        "select id, org_id, service, name_en, name_fr, price_cents, available,"
        " created_at, updated_at"
        " from ops.menu_items where id = :id and org_id = :org_id"
    ),
    "operations_fitness_class": (
        "select id, org_id, property_id, name, instructor_name, starts_at, ends_at,"
        " capacity, booked, location, description, status, created_at, updated_at"
        " from ops.fitness_classes where id = :id and org_id = :org_id"
    ),
    "operations_fitness_checkin": (
        "select id, org_id, property_id, guest_id, class_id, checked_in_at,"
        " source, notes, created_at, updated_at"
        " from ops.fitness_checkins where id = :id and org_id = :org_id"
    ),
    "operations_guest_service_request": (
        "select id, org_id, property_id, room_id, guest_id, type, note,"
        " assigned_to_user_id, completed_at, created_at, updated_at"
        " from ops.guest_service_requests where id = :id and org_id = :org_id"
    ),
    "operations_meeting_room": (
        "select id, org_id, property_id, name, capacity, created_at, updated_at"
        " from ops.meeting_rooms where id = :id and org_id = :org_id"
    ),
    "operations_meeting_booking": (
        "select id, org_id, property_id, meeting_room_id, organizer_guest_id_or_user_id,"
        " title, attendees_count, starts_at, ends_at, setup_status, created_at, updated_at"
        " from ops.meeting_bookings where id = :id and org_id = :org_id"
    ),
    "operations_guest_message_template": (
        "select id, org_id, name, language, body_template, created_at, updated_at"
        " from ops.guest_message_templates where id = :id and org_id = :org_id"
    ),
    "operations_guest_message_thread": (
        "select id, org_id, property_id, thread_id, guest_id, status,"
        " assigned_to_user_id, unread_count, last_message_at, created_at, updated_at"
        " from ops.guest_message_threads where id = :id and org_id = :org_id"
    ),
    "operations_room": (
        "select id, org_id, property_id, room_number, floor, type, status,"
        " current_reservation_id, last_service_at, vip, created_at, updated_at"
        " from ops.rooms where id = :id and org_id = :org_id"
    ),
    "operations_shift_handover": (
        "select id, org_id, property_id, shift_date, shift_label, summary_md,"
        " checklist_json, signed_by_user_id, signed_at, carry_forward_from_id,"
        " created_at, updated_at"
        " from ops.shift_handover where id = :id and org_id = :org_id"
    ),
    "operations_spa_service": (
        "select id, org_id, property_id, name, description, duration_minutes,"
        " price_cents, available, created_at, updated_at"
        " from ops.spa_services where id = :id and org_id = :org_id"
    ),
    "operations_spa_appointment": (
        "select id, org_id, property_id, guest_id, service, therapist_user_id,"
        " starts_at, ends_at, status, created_at, updated_at"
        " from ops.spa_appointments where id = :id and org_id = :org_id"
    ),
}

# ---------------------------------------------------------------------------
# Path → entity_type mapping
#
# Ordered most-specific first so longer prefixes win.
# Adding a new route is one tuple here.
# ---------------------------------------------------------------------------

_PATH_TO_ENTITY: list[tuple[str, str]] = [
    ("/api/admin/users",                          "admin_user"),
    ("/api/admin/devices",                        "admin_device"),
    ("/api/admin/properties",                     "admin_property"),
    ("/api/admin/form-definitions",               "admin_form_definition"),
    ("/api/operations/form-submissions",          "operations_form_submission"),
    ("/api/operations/incidents",                 "operations_incident"),
    ("/api/operations/action-queue",              "operations_action_queue"),
    ("/api/operations/fb/menu",                   "operations_menu_item"),
    ("/api/operations/fitness/classes",           "operations_fitness_class"),
    ("/api/operations/fitness/checkins",          "operations_fitness_checkin"),
    ("/api/operations/guest-services",            "operations_guest_service_request"),
    ("/api/operations/meetings/rooms",            "operations_meeting_room"),
    ("/api/operations/meetings/bookings",         "operations_meeting_booking"),
    ("/api/operations/messaging/templates",       "operations_guest_message_template"),
    ("/api/operations/messaging/threads",         "operations_guest_message_thread"),
    ("/api/operations/rooms",                     "operations_room"),
    ("/api/operations/shift-handover",            "operations_shift_handover"),
    ("/api/operations/spa/services",              "operations_spa_service"),
    ("/api/operations/spa/appointments",          "operations_spa_appointment"),
]


async def _best_effort_before_snapshot(
    *, session: AsyncSession, principal: Principal, entity_type: str, entity_id: str | None
) -> dict[str, Any] | None:
    if entity_id is None:
        return None
    query = _SNAPSHOT_QUERIES.get(entity_type)
    if query is None:
        return None
    row = await session.execute(
        text(query),
        {"id": entity_id, "org_id": str(principal.org_id)},
    )
    m = row.mappings().first()
    return dict(m) if m is not None else None


def _entity_type_for_path(path: str) -> str:
    for prefix, entity_type in _PATH_TO_ENTITY:
        if path.startswith(prefix):
            return entity_type
    return "unknown"


def _entity_id_from_path(path: str) -> str | None:
    parts = [p for p in path.split("/") if p]
    if len(parts) < 4 or parts[0] != "api" or parts[1] not in {"admin", "operations"}:
        return None
    # Try position 3 (flat: /api/operations/rooms/{uuid})
    # then position 4 (nested: /api/operations/meetings/rooms/{uuid}).
    candidates = [parts[3]] + ([parts[4]] if len(parts) > 4 else [])
    for candidate in candidates:
        try:
            return str(uuid.UUID(candidate))
        except Exception:  # noqa: BLE001,S112
            continue
    return None


class AuditLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if not _should_audit(request):
            return await call_next(request)

        path = request.url.path
        entity_type = _entity_type_for_path(path)
        entity_id = _entity_id_from_path(path)
        before_json: dict[str, Any] | None = None

        # Capture "before" snapshot in its own session to avoid depending on request DI.
        principal: Principal | None = getattr(request.state, "principal", None)
        try:
            if principal is not None:
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

        principal = getattr(request.state, "principal", principal)
        if principal is None:
            return response

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
            audit_user_id = await session.scalar(
                text("select id from users where id = :id and org_id = :org_id"),
                {"id": str(principal.user_id), "org_id": str(principal.org_id)},
            )
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
                    "user_id": str(audit_user_id) if audit_user_id is not None else None,
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