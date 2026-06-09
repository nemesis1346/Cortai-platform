import asyncio
import json
import os
from datetime import UTC, datetime

import asyncpg
import structlog

from app.config import get_settings

logger = structlog.get_logger(__name__)


def _dsn_for_asyncpg(database_url: str) -> str:
    if database_url.startswith("postgresql+asyncpg://"):
        return database_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    return database_url


async def main() -> None:
    settings = get_settings()
    dsn = _dsn_for_asyncpg(settings.database_url)

    # Safety: cap how many incidents we process per run.
    limit = int(os.getenv("INCIDENT_SLA_SWEEP_LIMIT", "50"))
    now = datetime.now(UTC)

    conn = await asyncpg.connect(dsn)
    try:
        org_rows = await conn.fetch("select id from organizations order by id")
        processed_total = 0

        from fastapi.encoders import jsonable_encoder

        for o in org_rows:
            org_id = str(o["id"])
            async with conn.transaction():
                # RLS: enforce tenant scope for this sweep.
                await conn.execute("select set_config('app.current_org_id', $1, true)", org_id)

                rows = await conn.fetch(
                    """
                    with due as (
                      select i.id, i.org_id, i.property_id, i.severity, i.status, i.title, i.description, i.assigned_to,
                             i.created_at, i.resolved_at, i.sla_due_at, c.auto_escalate
                      from operations.incidents i
                      left join ops.incident_sla_config c
                        on c.org_id = i.org_id and c.severity = i.severity::text
                      where i.sla_due_at is not null
                        and i.sla_due_at <= $1
                        and i.sla_escalated_at is null
                        and i.status::text != 'RESOLVED'
                      order by i.sla_due_at asc
                      limit $2
                    )
                    update operations.incidents i
                    set sla_escalated_at = $1,
                        severity = case when i.severity::text = 'CRITICAL' then i.severity else 'CRITICAL'::incident_severity end,
                        status = case when i.status::text = 'RESOLVED' then i.status else 'IN_PROGRESS'::incident_status end
                    from due
                    where i.id = due.id and i.org_id = due.org_id
                      and coalesce(due.auto_escalate, true) = true
                    returning i.id, i.org_id, i.property_id, i.severity, i.status, i.title, i.description, i.assigned_to,
                             i.created_at, i.resolved_at, i.sla_due_at, i.sla_escalated_at
                    """,
                    now,
                    limit,
                )

                for r in rows:
                    event = {
                        "type": "incident.sla_expired",
                        "org_id": str(r["org_id"]),
                        "property_id": str(r["property_id"]),
                        "incident": dict(r),
                        "_server_published_at": now.isoformat(),
                        "_server_published_at_ms": int(now.timestamp() * 1000),
                    }
                    await conn.execute(
                        "select pg_notify('cortai_live', $1)",
                        json.dumps(jsonable_encoder(event)),
                    )

                processed_total += len(rows)

        logger.info("ops.incident_sla_sweep_complete", processed=processed_total, limit=limit)
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())

