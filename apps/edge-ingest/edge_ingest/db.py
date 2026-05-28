from __future__ import annotations

import asyncpg  # type: ignore[import-untyped]


async def connect_pool(
    dsn: str, *, min_size: int = 1, max_size: int = 10
) -> asyncpg.Pool:  # pragma: no cover
    return await asyncpg.create_pool(dsn, min_size=min_size, max_size=max_size)


async def fetch_org_id_by_slug(conn: asyncpg.Connection, org_slug: str) -> str | None:
    row = await conn.fetchrow("select id from organizations where slug = $1", org_slug)
    return str(row["id"]) if row else None


async def fetch_property_id_by_slug(
    conn: asyncpg.Connection, *, org_id: str, property_slug: str
) -> str | None:
    # `properties` has RLS forced; ensure app.current_org_id is set in the same transaction.
    async with conn.transaction():
        await set_current_org(conn, org_id)
        row = await conn.fetchrow(
            "select id from properties where org_id = $1 and slug = $2", org_id, property_slug
        )
    return str(row["id"]) if row else None


async def set_current_org(conn: asyncpg.Connection, org_id: str) -> None:
    # Mirrors cortai-api. IMPORTANT: `is_local=true` only applies within the current transaction.
    await conn.execute("select set_config('app.current_org_id', $1, true)", org_id)


async def fetch_device_org_property_by_device_id(
    conn: asyncpg.Connection, *, device_id: str
) -> tuple[str, str | None] | None:
    """
    Return (org_id, property_id) for a globally-unique device_id.

    Security note: if the same `device_id` exists in multiple orgs, the identity is ambiguous.
    In that case we return None and the caller should reject/drop the message.
    """
    rows = await conn.fetch(
        """
        select org_id::text as org_id, property_id::text as property_id
        from platform.devices
        where device_id = $1
        """,
        device_id,
    )
    if not rows:
        return None
    if len(rows) > 1:
        return None
    row = rows[0]
    return str(row["org_id"]), (str(row["property_id"]) if row["property_id"] is not None else None)

