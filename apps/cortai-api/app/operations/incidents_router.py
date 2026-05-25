from __future__ import annotations

import csv
import io
import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep
from app.operations.incidents_schemas import (
    IncidentCreate,
    IncidentList,
    IncidentRead,
    IncidentSeverity,
    IncidentStatus,
    IncidentUpdate,
)

# Mounted under `app.operations.router` which already has `/api/operations` prefix.
router = APIRouter(prefix="/incidents", tags=["operations-incidents"])


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


@router.get("", response_model=IncidentList)
async def list_incidents(
    principal: PrincipalDep,
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
                select id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at
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
    payload: IncidentCreate, principal: PrincipalDep, session: SessionDep
) -> IncidentRead:
    incident_id = uuid.uuid4()
    now = datetime.now(UTC)
    stmt = text(
        """
        insert into operations.incidents (
          id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at
        )
        values (
          :id, :org_id, :property_id, :severity, :status, :title, :description, :assigned_to, :created_at, :resolved_at
        )
        returning id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at
        """
    )
    try:
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
                },
            )
        ).mappings().one()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    await session.commit()
    return IncidentRead(**dict(row))


@router.get("/export.csv")
async def export_incidents_csv(
    principal: PrincipalDep,
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
                select id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at
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
    incident_id: uuid.UUID, principal: PrincipalDep, session: SessionDep
) -> IncidentRead:
    row = (
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
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")
    return IncidentRead(**dict(row))


@router.patch("/{incident_id}", response_model=IncidentRead)
async def update_incident(
    incident_id: uuid.UUID,
    payload: IncidentUpdate,
    principal: PrincipalDep,
    session: SessionDep,
) -> IncidentRead:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

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

    stmt = text(
        f"""
        update operations.incidents
        set {", ".join(sets)}
        where id = :id and org_id = :org_id
        returning id, org_id, property_id, severity, status, title, description, assigned_to, created_at, resolved_at
        """  # noqa: S608
    )
    row = (await session.execute(stmt, params)).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")
    await session.commit()
    return IncidentRead(**dict(row))


@router.delete("/{incident_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_incident(
    incident_id: uuid.UUID, principal: PrincipalDep, session: SessionDep
) -> None:
    result = await session.execute(
        text("delete from operations.incidents where id = :id and org_id = :org_id"),
        {"id": str(incident_id), "org_id": str(principal.org_id)},
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")
    await session.commit()

