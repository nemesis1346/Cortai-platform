from __future__ import annotations

import csv
import io
import json
import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

import app.bridges.ai_client as ai_client
import app.notify.email as email
import app.storage.s3 as s3
from app.db import SessionDep
from app.i18n import LocaleDep, http_err
from app.operations.incidents_schemas import (
    IncidentAssignRequest,
    IncidentAttachmentPresignRequest,
    IncidentAttachmentPresignResponse,
    IncidentCreate,
    IncidentEscalateRequest,
    IncidentList,
    IncidentRead,
    IncidentSeverity,
    IncidentStatus,
    IncidentTriageResponse,
    IncidentUpdate,
)
from app.operations.rbac import OperationsPrincipalDep


async def _maybe_send_assignment_email(*, incident: dict, assigned_to: str | None) -> None:
    if not assigned_to:
        return
    subject = f"[COrtai] Incident assigned: {incident.get('title')}"
    body_lines = [
        f"Incident ID: {incident.get('id')}",
        f"Property ID: {incident.get('property_id')}",
        f"Assigned to user id: {assigned_to}",
        f"Severity: {incident.get('severity')}",
        f"Status: {incident.get('status')}",
    ]
    # Reuse escalation email channel for now.
    await email.send_escalation_email(subject=subject, body_text="\n".join(body_lines))

# Mounted under `app.operations.router` which already has `/api/operations` prefix.
router = APIRouter(prefix="/incidents", tags=["operations-incidents"])


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


async def _sla_due_at_for_severity(
    *, session: SessionDep, org_id: uuid.UUID, severity: IncidentSeverity
) -> datetime | None:
    """
    Computes SLA due timestamp based on ops.incident_sla_config.
    If no config exists yet, return None (SLA disabled).
    """
    minutes = await session.scalar(
        text(
            """
            select due_after_minutes
            from ops.incident_sla_config
            where org_id = :org_id and severity = :severity
            """
        ),
        {"org_id": str(org_id), "severity": severity.value},
    )
    if minutes is None:
        return None
    try:
        m = int(minutes)
    except Exception:  # noqa: BLE001
        return None
    return datetime.now(UTC) + timedelta(minutes=m)


@router.get("", response_model=IncidentList)
async def list_incidents(
    principal: OperationsPrincipalDep,
    session: SessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    property_id: uuid.UUID | None = None,
    severity: IncidentSeverity | None = None,
    status: IncidentStatus | None = None,
    search: str | None = None,
    start: str | None = None,
    end: str | None = None,
) -> IncidentList:
    filters = ["org_id = :org_id"]
    params: dict[str, object] = {"org_id": str(principal.org_id)}
    if property_id is not None:
        filters.append("property_id = :property_id")
        params["property_id"] = str(property_id)
    if severity is not None:
        filters.append("severity = :severity")
        params["severity"] = severity.value
    if status is not None:
        filters.append("status = :status")
        params["status"] = status.value
    if search:
        filters.append("(title ilike :search or description ilike :search)")
        params["search"] = f"%{search.strip()}%"
    if (dt := _parse_dt(start)) is not None:
        filters.append("created_at >= :start")
        params["start"] = dt
    if (dt := _parse_dt(end)) is not None:
        filters.append("created_at <= :end")
        params["end"] = dt

    where = " and ".join(filters)
    total = await session.scalar(
        text(f"select count(*) from operations.incidents where {where}"),  # noqa: S608
        params,
    )
    rows = (
        await session.execute(
            text(
                f"""
                select id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at, sla_due_at, sla_escalated_at
                from operations.incidents
                where {where}
                order by created_at desc
                offset :offset limit :limit
                """  # noqa: S608
            ),
            {**params, "offset": (page - 1) * page_size, "limit": page_size},
        )
    ).mappings().all()

    return IncidentList(
        items=[IncidentRead(**dict(r)) for r in rows],
        total=int(total or 0),
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=IncidentRead, status_code=status.HTTP_201_CREATED)
async def create_incident(
    payload: IncidentCreate, principal: OperationsPrincipalDep, session: SessionDep
) -> IncidentRead:
    incident_id = uuid.uuid4()
    now = datetime.now(UTC)
    stmt = text(
        """
        insert into operations.incidents (
          id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at, sla_due_at, sla_escalated_at
        )
        values (
          :id, :org_id, :property_id, :severity, :status, :title, :description, :assigned_to, :created_at, :resolved_at, :sla_due_at, null
        )
        returning id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at, sla_due_at, sla_escalated_at
        """
    )
    try:
        sla_due_at = await _sla_due_at_for_severity(
            session=session, org_id=principal.org_id, severity=payload.severity
        )
        row = (
            await session.execute(
                stmt,
                {
                    "id": str(incident_id),
                    "org_id": str(principal.org_id),
                    "property_id": str(payload.property_id),
                    "severity": payload.severity.value,
                    "status": payload.status.value,
                    "title": payload.title,
                    "description": payload.description,
                    "assigned_to": str(payload.assigned_to) if payload.assigned_to else None,
                    "created_at": now,
                    "resolved_at": None,
                    "sla_due_at": sla_due_at,
                },
            )
        ).mappings().one()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    await session.commit()
    return IncidentRead(**dict(row))


@router.get("/export.csv")
async def export_incidents_csv(
    principal: OperationsPrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID | None = None,
    severity: IncidentSeverity | None = None,
    status: IncidentStatus | None = None,
    search: str | None = None,
    start: str | None = None,
    end: str | None = None,
) -> Response:
    # Reuse the list query but without pagination.
    filters = ["org_id = :org_id"]
    params: dict[str, object] = {"org_id": str(principal.org_id)}
    if property_id is not None:
        filters.append("property_id = :property_id")
        params["property_id"] = str(property_id)
    if severity is not None:
        filters.append("severity = :severity")
        params["severity"] = severity.value
    if status is not None:
        filters.append("status = :status")
        params["status"] = status.value
    if search:
        filters.append("(title ilike :search or description ilike :search)")
        params["search"] = f"%{search.strip()}%"
    if (dt := _parse_dt(start)) is not None:
        filters.append("created_at >= :start")
        params["start"] = dt
    if (dt := _parse_dt(end)) is not None:
        filters.append("created_at <= :end")
        params["end"] = dt
    where = " and ".join(filters)

    rows = (
        await session.execute(
            text(
                f"""
                select id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at, sla_due_at, sla_escalated_at
                from operations.incidents
                where {where}
                order by created_at desc
                """  # noqa: S608
            ),
            params,
        )
    ).mappings().all()

    buf = io.StringIO()
    writer = csv.DictWriter(
        buf,
        fieldnames=[
            "id",
            "org_id",
            "property_id",
            "severity",
            "status",
            "title",
            "description",
            "assigned_to",
            "created_at",
            "resolved_at",
        ],
        extrasaction="ignore",
    )
    writer.writeheader()
    for r in rows:
        writer.writerow(dict(r))

    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"content-disposition": "attachment; filename=incidents.csv"},
    )


@router.get("/{incident_id}", response_model=IncidentRead)
async def get_incident(
    incident_id: uuid.UUID, principal: OperationsPrincipalDep, session: SessionDep, locale: LocaleDep
) -> IncidentRead:
    row = (
        await session.execute(
            text(
                """
                select id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at, sla_due_at, sla_escalated_at
                from operations.incidents
                where id = :id and org_id = :org_id
                """
            ),
            {"id": str(incident_id), "org_id": str(principal.org_id)},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.incidents.not_found", locale))
    return IncidentRead(**dict(row))


@router.patch("/{incident_id}", response_model=IncidentRead)
async def update_incident(
    incident_id: uuid.UUID,
    payload: IncidentUpdate,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
) -> IncidentRead:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=http_err("operations.common.no_fields_to_update", locale))

    sets: list[str] = []
    params: dict[str, object] = {"id": str(incident_id), "org_id": str(principal.org_id)}

    for k, v in data.items():
        if k in {"severity", "status"} and v is not None:
            sets.append(f"{k} = :{k}")  # noqa: S608
            params[k] = v.value  # enums
        elif k == "assigned_to":
            sets.append("assigned_to = :assigned_to")
            params["assigned_to"] = str(v) if v else None
        elif k == "property_id":
            sets.append("property_id = :property_id")
            params["property_id"] = str(v) if v else None
        else:
            sets.append(f"{k} = :{k}")  # noqa: S608
            params[k] = v

    # If status transitions to RESOLVED and resolved_at wasn't explicitly provided, set it.
    if "status" in data and data.get("status") == IncidentStatus.RESOLVED and "resolved_at" not in data:
        sets.append("resolved_at = now()")

    # Recompute SLA due when severity changes.
    if "severity" in data and data.get("severity") is not None:
        sev: IncidentSeverity = data["severity"]
        sla_due_at = await _sla_due_at_for_severity(session=session, org_id=principal.org_id, severity=sev)
        sets.append("sla_due_at = :sla_due_at")
        params["sla_due_at"] = sla_due_at
        # Reset escalation marker on severity change (fresh SLA cycle).
        sets.append("sla_escalated_at = null")

    stmt = text(
        f"""
        update operations.incidents
        set {", ".join(sets)}
        where id = :id and org_id = :org_id
        returning id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at, sla_due_at, sla_escalated_at
        """  # noqa: S608
    )
    row = (await session.execute(stmt, params)).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.incidents.not_found", locale))
    await session.commit()
    return IncidentRead(**dict(row))


@router.patch("/{incident_id}/assign", response_model=IncidentRead)
async def assign_incident(
    incident_id: uuid.UUID,
    payload: IncidentAssignRequest,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
) -> IncidentRead:
    # Validate assignee exists in this org (avoid FK 500s).
    if payload.assigned_to is not None:
        exists = await session.scalar(
            text("select 1 from users where id = :id and org_id = :org_id"),
            {"id": str(payload.assigned_to), "org_id": str(principal.org_id)},
        )
        if exists is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.incidents.assignee_not_found", locale))

    row = (
        await session.execute(
            text(
                """
                update operations.incidents
                set assigned_to = :assigned_to
                where id = :id and org_id = :org_id
                returning id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at, sla_due_at, sla_escalated_at
                """
            ),
            {
                "id": str(incident_id),
                "org_id": str(principal.org_id),
                "assigned_to": str(payload.assigned_to) if payload.assigned_to else None,
            },
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.incidents.not_found", locale))

    now = datetime.now(UTC)
    event = {
        "type": "incident.assigned",
        "org_id": str(principal.org_id),
        "property_id": str(row["property_id"]),
        "incident": dict(row),
        "_server_published_at": now.isoformat(),
        "_server_published_at_ms": int(now.timestamp() * 1000),
    }
    await session.execute(
        text("select pg_notify('cortai_live', :payload)"),
        {"payload": json.dumps(jsonable_encoder(event))},
    )

    await _maybe_send_assignment_email(incident=dict(row), assigned_to=str(payload.assigned_to) if payload.assigned_to else None)

    await session.commit()
    return IncidentRead(**dict(row))


@router.post("/{incident_id}/attachments", response_model=IncidentAttachmentPresignResponse)
async def create_incident_attachment_upload(
    incident_id: uuid.UUID,
    payload: IncidentAttachmentPresignRequest,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
) -> IncidentAttachmentPresignResponse:
    inc = (
        await session.execute(
            text(
                """
                select id, org_id, property_id
                from operations.incidents
                where id = :id and org_id = :org_id
                """
            ),
            {"id": str(incident_id), "org_id": str(principal.org_id)},
        )
    ).mappings().first()
    if inc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.incidents.not_found", locale))

    attachment_id = uuid.uuid4()
    key = s3.incident_attachment_key(
        org_id=principal.org_id,
        incident_id=incident_id,
        attachment_id=attachment_id,
        filename=payload.filename,
    )
    signed = s3.presign_put(key=key, content_type=payload.content_type)
    return IncidentAttachmentPresignResponse(
        key=key,
        upload_url=signed.url,
        upload_headers=signed.headers,
    )


@router.post("/{incident_id}/escalate", response_model=IncidentRead)
async def escalate_incident(
    incident_id: uuid.UUID,
    payload: IncidentEscalateRequest,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
) -> IncidentRead:
    # Escalation updates severity/status and notifies.
    inc = (
        await session.execute(
            text(
                """
                select id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at
                from operations.incidents
                where id = :id and org_id = :org_id
                """
            ),
            {"id": str(incident_id), "org_id": str(principal.org_id)},
        )
    ).mappings().first()
    if inc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.incidents.not_found", locale))

    next_severity = payload.severity or IncidentSeverity.CRITICAL

    sla_due_at = await _sla_due_at_for_severity(
        session=session, org_id=principal.org_id, severity=next_severity
    )
    updated = (
        await session.execute(
            text(
                """
                update operations.incidents
                set severity = :severity,
                    status = case when status = 'RESOLVED' then status else 'IN_PROGRESS' end,
                    sla_due_at = :sla_due_at,
                    sla_escalated_at = null
                where id = :id and org_id = :org_id
                returning id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at, sla_due_at, sla_escalated_at
                """
            ),
            {
                "id": str(incident_id),
                "org_id": str(principal.org_id),
                "severity": next_severity.value,
                "sla_due_at": sla_due_at,
            },
        )
    ).mappings().one()

    now = datetime.now(UTC)
    event = {
        "type": "incident.escalated",
        "org_id": str(principal.org_id),
        "property_id": str(updated["property_id"]),
        "incident": dict(updated),
        "reason": payload.reason,
        "_server_published_at": now.isoformat(),
        "_server_published_at_ms": int(now.timestamp() * 1000),
    }
    await session.execute(
        text("select pg_notify('cortai_live', :payload)"),
        {"payload": json.dumps(jsonable_encoder(event))},
    )

    subject = f"[COrtai] Incident escalated: {updated['title']}"
    body_lines = [
        f"Incident ID: {updated['id']}",
        f"Org ID: {updated['org_id']}",
        f"Property ID: {updated['property_id']}",
        f"Severity: {updated['severity']}",
        f"Status: {updated['status']}",
    ]
    if payload.reason:
        body_lines.append("")
        body_lines.append(f"Reason: {payload.reason}")
    await email.send_escalation_email(subject=subject, body_text="\n".join(body_lines))

    await session.commit()
    return IncidentRead(**dict(updated))


@router.post("/{incident_id}/triage", response_model=IncidentTriageResponse)
async def triage_incident(
    incident_id: uuid.UUID,
    request: Request,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
) -> IncidentTriageResponse:
    inc = (
        await session.execute(
            text(
                """
                select id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at
                from operations.incidents
                where id = :id and org_id = :org_id
                """
            ),
            {"id": str(incident_id), "org_id": str(principal.org_id)},
        )
    ).mappings().first()
    if inc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.incidents.not_found", locale))

    payload = {
        "id": str(inc["id"]),
        "org_id": str(inc["org_id"]),
        "property_id": str(inc["property_id"]),
        "severity": str(inc["severity"]),
        "status": str(inc["status"]),
        "title": inc["title"],
        "description": inc["description"],
        "assigned_to": str(inc["assigned_to"]) if inc["assigned_to"] else None,
        "created_at": inc["created_at"].isoformat() if inc["created_at"] else None,
        "resolved_at": inc["resolved_at"].isoformat() if inc["resolved_at"] else None,
    }
    resp = await ai_client.post_incident_triage(request=request, incident=payload)
    return IncidentTriageResponse(**resp)


@router.delete("/{incident_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_incident(
    incident_id: uuid.UUID, principal: OperationsPrincipalDep, session: SessionDep, locale: LocaleDep
) -> None:
    result = await session.execute(
        text("delete from operations.incidents where id = :id and org_id = :org_id"),
        {"id": str(incident_id), "org_id": str(principal.org_id)},
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.incidents.not_found", locale))
    await session.commit()

