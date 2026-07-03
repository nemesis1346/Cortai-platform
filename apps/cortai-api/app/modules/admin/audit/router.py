"""AUDIT-01 — streaming audit log export for PHIPA/PIPEDA compliance.

GET /api/admin/audit/export?from=<ISO>&to=<ISO>&format=csv|json|jsonl
IT_ADMIN only. Streams rows via server-side cursor to avoid memory spikes.
"""

from __future__ import annotations

import csv
import io
import json
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep, require_roles_dep
from app.db import SessionLocal, set_current_org
from app.models import UserRole

router = APIRouter(prefix="/api/admin/audit", tags=["admin-audit"])

_IT_ADMIN = {UserRole.IT_ADMIN}
ITAdminDep = Annotated[PrincipalDep, Depends(require_roles_dep(_IT_ADMIN))]

_MAX_DAYS = 366

_COLS = [
    "id", "org_id", "user_id", "action", "entity_type",
    "entity_id", "ts", "ip", "user_agent", "before_json", "after_json",
]

_QUERY = (
    "select id, org_id, user_id, action, entity_type, entity_id,"
    " ts, ip, user_agent, before_json, after_json"
    " from audit.change_log"
    " where org_id = :org_id and ts >= :from_dt and ts < :to_dt"
    " order by ts"
)

_MEDIA = {
    "csv": "text/csv; charset=utf-8",
    "json": "application/json; charset=utf-8",
    "jsonl": "application/x-ndjson; charset=utf-8",
}


def _serialize(v: Any) -> Any:
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, datetime):
        return v.isoformat()
    return v


def _row_to_json(row: Any) -> str:
    return json.dumps({k: _serialize(v) for k, v in dict(row).items()}, default=str)


def _row_to_csv(row: Any) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="")
    d = dict(row)
    cells: list[str] = []
    for col in _COLS:
        v = d.get(col)
        if v is None:
            cells.append("")
        elif isinstance(v, dict):
            cells.append(json.dumps(v))
        else:
            cells.append(str(_serialize(v)))
    writer.writerow(cells)
    return buf.getvalue()


async def _stream(
    org_id: uuid.UUID,
    from_dt: datetime,
    to_dt: datetime,
    fmt: str,
) -> Any:
    params = {"org_id": str(org_id), "from_dt": from_dt, "to_dt": to_dt}
    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        result = await session.stream(sa.text(_QUERY), params)

        if fmt == "jsonl":
            async for batch in result.mappings().partitions(500):
                for row in batch:
                    yield _row_to_json(row) + "\n"

        elif fmt == "json":
            first = True
            yield "[\n"
            async for batch in result.mappings().partitions(500):
                for row in batch:
                    prefix = "" if first else ",\n"
                    yield prefix + _row_to_json(row)
                    first = False
            yield "\n]\n"

        elif fmt == "csv":
            yield ",".join(_COLS) + "\n"
            async for batch in result.mappings().partitions(500):
                for row in batch:
                    yield _row_to_csv(row) + "\n"


@router.get("/export")
async def export_audit(
    principal: ITAdminDep,
    from_dt: datetime = Query(..., alias="from", description="Start of range (inclusive, ISO-8601)"),
    to_dt: datetime = Query(..., alias="to", description="End of range (exclusive, ISO-8601)"),
    fmt: Literal["csv", "json", "jsonl"] = Query(default="jsonl", alias="format"),
) -> StreamingResponse:
    if to_dt <= from_dt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="'to' must be after 'from'",
        )
    delta_days = (to_dt - from_dt).days
    if delta_days > _MAX_DAYS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Date range cannot exceed {_MAX_DAYS} days",
        )

    fname = (
        f"audit_{from_dt.date()}_{to_dt.date()}.{fmt}"
        .replace("jsonl", "ndjson")  # friendlier extension for downloads
    )
    return StreamingResponse(
        _stream(principal.org_id, from_dt, to_dt, fmt),
        media_type=_MEDIA[fmt],
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )