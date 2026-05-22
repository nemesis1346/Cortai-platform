from __future__ import annotations

import asyncpg


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

