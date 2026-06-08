import asyncio
import json
import os
from datetime import UTC, datetime, timedelta

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

    offline_after_seconds = int(os.getenv("DE08_OFFLINE_AFTER_SECONDS", "90"))
    interval = timedelta(seconds=offline_after_seconds)
    now = datetime.now(UTC)
    cutoff = now - interval

    conn = await asyncpg.connect(dsn)
    try:
        # Mark devices offline exactly once (don’t spam alerts every run).
        rows = await conn.fetch(
            """
            update platform.devices
            set is_offline = true,
                offline_since = coalesce(offline_since, $1)
            where last_seen_at is not null
              and last_seen_at < $2
              and is_offline = false
            returning org_id, property_id, device_id, last_seen_at, offline_since
            """,
            now,
            cutoff,
        )

        for r in rows:
            event = {
                "type": "device_offline",
                "org_id": str(r["org_id"]),
                "property_id": str(r["property_id"]) if r["property_id"] else None,
                "device_id": r["device_id"],
                "last_seen_at": r["last_seen_at"].astimezone(UTC).isoformat(),
                "offline_since": r["offline_since"].astimezone(UTC).isoformat(),
                "_server_published_at": now.isoformat(),
                "_server_published_at_ms": int(now.timestamp() * 1000),
            }
            # Ensure UUID/datetime payloads are JSON-serializable (matches FastAPI encoders).
            from fastapi.encoders import jsonable_encoder

            await conn.execute("select pg_notify('cortai_live', $1)", json.dumps(jsonable_encoder(event)))

        logger.info(
            "de08.offline_sweep_complete",
            offline_after_seconds=offline_after_seconds,
            cutoff=cutoff.isoformat(),
            marked_offline=len(rows),
        )
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())

