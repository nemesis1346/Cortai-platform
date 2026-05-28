from __future__ import annotations

import json
import uuid

import asyncpg  # type: ignore[import-untyped]
import pytest

from edge_ingest.config import get_settings
from edge_ingest.main import _persist_message


async def _connect_or_skip() -> asyncpg.Connection:
    try:
        return await asyncpg.connect(get_settings().database_url)
    except OSError as exc:
        pytest.skip(f"Postgres is not available for integration test: {exc}")
    except asyncpg.PostgresError as exc:
        pytest.skip(f"Postgres rejected integration test connection: {exc}")


async def _require_schema_or_skip(conn: asyncpg.Connection) -> None:
    device_health = await conn.fetchval("select to_regclass('iot.device_health')")
    devices = await conn.fetchval("select to_regclass('platform.devices')")
    if device_health is None or devices is None:
        pytest.skip("edge-ingest integration schema is not migrated")


async def _set_current_org(conn: asyncpg.Connection, org_id: str) -> None:
    await conn.execute("select set_config('app.current_org_id', $1, true)", org_id)


@pytest.mark.asyncio
async def test_persist_message_sets_rls_context_and_inserts_health_row() -> None:
    conn = await _connect_or_skip()
    await _require_schema_or_skip(conn)

    org_id = str(uuid.uuid4())
    property_id = str(uuid.uuid4())
    device_id = f"edge-test-{uuid.uuid4()}"
    org_slug = f"edge-ingest-test-{uuid.uuid4()}"

    try:
        await conn.execute(
            """
            insert into organizations (id, name, slug, created_at, updated_at)
            values ($1::uuid, 'Edge Ingest Test Org', $2, now(), now())
            """,
            org_id,
            org_slug,
        )

        async with conn.transaction():
            await _set_current_org(conn, org_id)
            await conn.execute(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status)
                values (
                  $1::uuid, $2::uuid, 'Edge Ingest Test Property',
                  'edge-test', now(), now(), 'ACTIVE'
                )
                """,
                property_id,
                org_id,
            )
            await conn.execute(
                """
                insert into platform.devices (
                  id, org_id, property_id, device_id, type, capabilities, cert_fingerprint,
                  logical_bindings, last_seen_at, is_offline, offline_since, created_at, updated_at
                )
                values (
                  gen_random_uuid(), $1::uuid, $2::uuid, $3,
                  'edge_distributed', array['mqtt_publish'],
                  null, '{}'::jsonb, null, true, now(), now(), now()
                )
                """,
                org_id,
                property_id,
                device_id,
            )

        current_org = await conn.fetchval("select current_setting('app.current_org_id', true)")
        assert current_org in ("", None)

        await _persist_message(
            conn,
            org_id=org_id,
            property_id=property_id,
            topic_type="health",
            message={
                "device_id": device_id,
                "ts": "2026-05-28T20:00:00Z",
                "type": "health",
                "schema_version": "1.0",
                "payload": {"status": "ok"},
                "_broker_received_at_ms": 1_779_999_999_000,
            },
            enable_live_notify=False,
            enable_device_last_seen=True,
        )

        current_org = await conn.fetchval("select current_setting('app.current_org_id', true)")
        assert current_org in ("", None)

        async with conn.transaction():
            await _set_current_org(conn, org_id)
            row = await conn.fetchrow(
                """
                select org_id::text as org_id,
                       property_id::text as property_id,
                       device_id,
                       schema_version,
                       payload
                from iot.device_health
                where org_id = $1::uuid and property_id = $2::uuid and device_id = $3
                """,
                org_id,
                property_id,
                device_id,
            )
            device = await conn.fetchrow(
                """
                select last_seen_at, is_offline, offline_since
                from platform.devices
                where org_id = $1::uuid and device_id = $2
                """,
                org_id,
                device_id,
            )

        assert row is not None
        assert row["org_id"] == org_id
        assert row["property_id"] == property_id
        assert row["device_id"] == device_id
        assert row["schema_version"] == "1.0"
        payload = row["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)
        assert payload == {"status": "ok"}

        assert device is not None
        assert device["last_seen_at"] is not None
        assert device["is_offline"] is False
        assert device["offline_since"] is None
    finally:
        async with conn.transaction():
            await _set_current_org(conn, org_id)
            await conn.execute("delete from iot.device_health where org_id = $1::uuid", org_id)
            await conn.execute("delete from platform.devices where org_id = $1::uuid", org_id)
            await conn.execute("delete from properties where org_id = $1::uuid", org_id)
        await conn.execute("delete from organizations where id = $1::uuid", org_id)
        await conn.close()

