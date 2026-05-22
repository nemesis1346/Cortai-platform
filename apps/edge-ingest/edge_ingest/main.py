from __future__ import annotations

import asyncio
import json
import ssl
import time
from datetime import UTC, datetime
from typing import Any

import asyncpg
import structlog
from asyncio_mqtt import Client, MqttError
from paho.mqtt import client as paho_mqtt

from edge_ingest.config import get_settings
from edge_ingest.db import (
    connect_pool,
    fetch_org_id_by_slug,
    fetch_property_id_by_slug,
    set_current_org,
)
from edge_ingest.logging import configure_logging
from edge_ingest.schema_validation import EdgeEnvelopeValidationError, validate_edge_envelope
from edge_ingest.topic import parse_edge_topic

logger = structlog.get_logger(__name__)

try:
    import orjson as _json  # type: ignore[import-not-found]
except Exception:  # noqa: BLE001
    _json = None


class _LookupCache:
    def __init__(self) -> None:
        self.org_by_slug: dict[str, str] = {}
        self.property_by_key: dict[tuple[str, str], str] = {}

    def get_org(self, slug: str) -> str | None:
        return self.org_by_slug.get(slug)

    def set_org(self, slug: str, org_id: str) -> None:
        self.org_by_slug[slug] = org_id

    def get_property(self, org_id: str, slug: str) -> str | None:
        return self.property_by_key.get((org_id, slug))

    def set_property(self, org_id: str, slug: str, property_id: str) -> None:
        self.property_by_key[(org_id, slug)] = property_id


def _parse_ts(value: Any) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("ts must be a non-empty string")
    s = value.strip()
    # Accept RFC3339 "Z" form.
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def _ssl_context(ca_file: str, cert_file: str, key_file: str) -> ssl.SSLContext:
    ctx = ssl.create_default_context(ssl.Purpose.SERVER_AUTH, cafile=ca_file)
    ctx.load_cert_chain(certfile=cert_file, keyfile=key_file)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_3
    return ctx


async def _persist_message(
    conn: asyncpg.Connection,
    *,
    org_id: str,
    property_id: str,
    topic_type: str,
    message: dict[str, Any],
    enable_live_notify: bool,
    enable_device_last_seen: bool,
) -> None:
    table_by_type = {
        "detection": "iot.camera_detections",
        "telemetry": "iot.sensor_readings",
        "health": "iot.device_health",
        "event": "iot.edge_events",
    }
    table = table_by_type.get(topic_type)
    if table is None:
        logger.warning("edge.message.unknown_type", topic_type=topic_type)
        return

    async with conn.transaction():
        await set_current_org(conn, org_id)

        last_seen_at = datetime.now(UTC)
        if enable_device_last_seen:
            # DE-08: Update device last-seen on any successfully validated message ingestion.
            # Use broker/server receive time to avoid device clock skew.
            await conn.execute(
                """
                update platform.devices
                set last_seen_at = $1,
                    is_offline = false,
                    offline_since = null
                where org_id = $2 and device_id = $3
                """,
                last_seen_at,
                org_id,
                message["device_id"],
            )
        await conn.execute(
            f"""
            insert into {table} (org_id, property_id, device_id, ts, schema_version, payload)
            values ($1, $2, $3, $4, $5, $6::jsonb)
            """,
            org_id,
            property_id,
            message["device_id"],
            _parse_ts(message["ts"]),
            message["schema_version"],
            json.dumps(message["payload"]),
        )

        if enable_live_notify:
            # Publish a live event for DE-05 via Postgres NOTIFY.
            # Channel naming is fixed (`cortai_live`) and messages are filtered by property_id downstream.
            live_event = {
                "type": "edge_message",
                "org_id": org_id,
                "property_id": property_id,
                "topic_type": topic_type,
                "device_id": message["device_id"],
                "ts": message["ts"],
                "schema_version": message["schema_version"],
                "payload": message["payload"],
                "_broker_received_at_ms": message.get("_broker_received_at_ms"),
                "_ingested_at_ms": int(datetime.now(UTC).timestamp() * 1000),
                "_device_last_seen_at": last_seen_at.isoformat(),
            }
            await conn.execute("select pg_notify('cortai_live', $1)", json.dumps(live_event))

    logger.info(
        "edge.message.persisted",
        org_id=org_id,
        property_id=property_id,
        topic_type=topic_type,
        device_id=message["device_id"],
    )


async def run() -> None:
    configure_logging()
    settings = get_settings()

    if not settings.mqtt_client_cert or not settings.mqtt_client_key:
        raise RuntimeError("MQTT_CLIENT_CERT and MQTT_CLIENT_KEY are required")

    ssl_ctx = _ssl_context(settings.mqtt_ca_file, settings.mqtt_client_cert, settings.mqtt_client_key)

    pool = await connect_pool(
        settings.database_url,
        min_size=settings.db_pool_min_size,
        max_size=settings.db_pool_max_size,
    )
    cache = _LookupCache()
    q_max = settings.ingest_queue_maxsize if settings.ingest_queue_maxsize > 0 else settings.ingest_workers * 4
    queue: asyncio.Queue[tuple[str, int, bytes]] = asyncio.Queue(maxsize=q_max)
    stats: dict[str, int] = {"received": 0, "persisted": 0, "rejected": 0, "dropped": 0, "errors": 0}

    async def _stats_logger() -> None:
        last = time.monotonic()
        last_counts = stats.copy()
        while True:
            await asyncio.sleep(settings.stats_interval_s)
            now = time.monotonic()
            dt = max(1e-6, now - last)
            delta = {k: stats[k] - last_counts.get(k, 0) for k in stats}
            logger.info(
                "edge_ingest.stats",
                interval_s=round(dt, 3),
                **{f"{k}_per_s": round(v / dt, 2) for k, v in delta.items()},
                **stats,
            )
            last = now
            last_counts = stats.copy()

    async def _batch_flusher(
        *,
        worker_id: int,
        topic_type: str,
        buf: list[tuple[str, str, str, datetime, str, str]],
        deadline: float,
        org_id: str,
        property_id: str,
    ) -> tuple[list[tuple[str, str, str, datetime, str, str]], float]:
        """
        Flush buffer of rows for one table via COPY (fast path).
        Row tuple: (org_id, property_id, device_id, ts, schema_version, payload_json)
        """
        if not buf:
            return buf, deadline

        table_by_type = {
            "detection": "iot.camera_detections",
            "telemetry": "iot.sensor_readings",
            "health": "iot.device_health",
            "event": "iot.edge_events",
        }
        table = table_by_type[topic_type]
        async with pool.acquire() as conn:
            async with conn.transaction():
                await set_current_org(conn, org_id)
                await conn.copy_records_to_table(
                    table_name=table.split(".", 1)[1],
                    schema_name=table.split(".", 1)[0],
                    records=buf,
                    columns=["org_id", "property_id", "device_id", "ts", "schema_version", "payload"],
                )
        stats["persisted"] += len(buf)
        buf = []
        deadline = time.monotonic() + (settings.batch_flush_ms / 1000.0)
        return buf, deadline

    async def _worker(worker_id: int) -> None:
        # Per-topic-type buffers for perf mode.
        buffers: dict[str, list[tuple[str, str, str, datetime, str, str]]] = {
            "detection": [],
            "telemetry": [],
            "health": [],
            "event": [],
        }
        deadlines: dict[str, float] = {
            k: time.monotonic() + (settings.batch_flush_ms / 1000.0) for k in buffers
        }

        while True:
            try:
                topic, broker_received_at_ms, payload_bytes = await asyncio.wait_for(queue.get(), timeout=0.05)
            except TimeoutError:
                # Periodic flush on idle.
                if settings.perf_mode:
                    now = time.monotonic()
                    for tt in list(buffers.keys()):
                        if buffers[tt] and now >= deadlines[tt]:
                            buffers[tt], deadlines[tt] = await _batch_flusher(
                                worker_id=worker_id,
                                topic_type=tt,
                                buf=buffers[tt],
                                deadline=deadlines[tt],
                                org_id=buffers[tt][0][0],
                                property_id=buffers[tt][0][1],
                            )
                continue
            try:
                try:
                    if _json is not None:
                        payload = _json.loads(payload_bytes)
                    else:
                        payload = json.loads(payload_bytes.decode("utf-8"))
                except Exception as e:  # noqa: BLE001
                    logger.warning("edge.message.invalid_json", topic=topic, error=str(e), worker_id=worker_id)
                    stats["errors"] += 1
                    continue

                if settings.validate_envelope:
                    try:
                        validate_edge_envelope(payload)
                    except EdgeEnvelopeValidationError as e:
                        logger.warning(
                            "edge.payload.schema_rejected",
                            topic=topic,
                            errors=e.errors,
                            worker_id=worker_id,
                        )
                        stats["rejected"] += 1
                        continue

                t = parse_edge_topic(topic)

                # Envelope must match topic
                if payload.get("device_id") != t.device_id or payload.get("type") != t.msg_type:
                    logger.warning(
                        "edge.payload.topic_mismatch",
                        topic=topic,
                        org=t.org,
                        property=t.property,
                        topic_device_id=t.device_id,
                        topic_type=t.msg_type,
                        envelope_device_id=payload.get("device_id"),
                        envelope_type=payload.get("type"),
                    )
                    continue

                org_id = cache.get_org(t.org)
                if org_id is None:
                    async with pool.acquire() as conn:
                        org_id = await fetch_org_id_by_slug(conn, t.org)
                    if org_id is None:
                        logger.warning("edge.unknown_org", org=t.org, topic=topic)
                        stats["dropped"] += 1
                        continue
                    cache.set_org(t.org, org_id)

                property_id = cache.get_property(org_id, t.property)
                if property_id is None:
                    async with pool.acquire() as conn:
                        property_id = await fetch_property_id_by_slug(conn, org_id=org_id, property_slug=t.property)
                    if property_id is None:
                        logger.warning("edge.unknown_property", org=t.org, property=t.property, topic=topic)
                        stats["dropped"] += 1
                        continue
                    cache.set_property(org_id, t.property, property_id)

                if settings.perf_mode:
                    # Fast path: batch inserts; optionally skip last-seen updates and notify.
                    table_type = t.msg_type
                    if table_type not in buffers:
                        stats["dropped"] += 1
                        continue
                    try:
                        # In perf mode, use broker/server receive time to avoid expensive RFC3339 parsing
                        # and to reflect ingestion timing under load.
                        ts = datetime.fromtimestamp(broker_received_at_ms / 1000.0, tz=UTC)
                        row = (
                            org_id,
                            property_id,
                            str(payload["device_id"]),
                            ts,
                            str(payload["schema_version"]),
                            json.dumps(payload["payload"]),
                        )
                    except Exception:  # noqa: BLE001
                        stats["errors"] += 1
                        continue

                    buffers[table_type].append(row)
                    if len(buffers[table_type]) >= settings.batch_size:
                        buffers[table_type], deadlines[table_type] = await _batch_flusher(
                            worker_id=worker_id,
                            topic_type=table_type,
                            buf=buffers[table_type],
                            deadline=deadlines[table_type],
                            org_id=org_id,
                            property_id=property_id,
                        )
                else:
                    async with pool.acquire() as conn:
                        await _persist_message(
                            conn,
                            org_id=org_id,
                            property_id=property_id,
                            topic_type=t.msg_type,
                            message={**payload, "_broker_received_at_ms": broker_received_at_ms},
                            enable_live_notify=settings.enable_live_notify,
                            enable_device_last_seen=settings.enable_device_last_seen,
                        )
                        stats["persisted"] += 1
            except Exception as e:  # noqa: BLE001
                logger.exception("edge.message.processing_failed", topic=topic, error=str(e), worker_id=worker_id)
                stats["errors"] += 1
            finally:
                queue.task_done()

    try:
        if settings.perf_mode:
            logger.warning(
                "edge_ingest.perf_mode_enabled",
                batch_size=settings.batch_size,
                batch_flush_ms=settings.batch_flush_ms,
                validate_envelope=settings.validate_envelope,
            )

        stats_task = asyncio.create_task(_stats_logger())
        workers = [asyncio.create_task(_worker(i)) for i in range(settings.ingest_workers)]
        async with Client(
            hostname=settings.mqtt_host,
            port=settings.mqtt_port,
            tls_context=ssl_ctx,
            client_id=settings.mqtt_client_id,
            # NOTE: `protocol` here is the MQTT protocol version (paho-mqtt),
            # not an SSL/TLS protocol constant.
            protocol=paho_mqtt.MQTTv311,
        ) as client:
            async with client.filtered_messages(settings.mqtt_topic) as messages:
                await client.subscribe(settings.mqtt_topic, qos=settings.mqtt_sub_qos)
                logger.info(
                    "edge_ingest.subscribed",
                    host=settings.mqtt_host,
                    port=settings.mqtt_port,
                    topic=settings.mqtt_topic,
                    qos=settings.mqtt_sub_qos,
                )

                async for msg in messages:
                    try:
                        broker_received_at_ms = int(datetime.now(UTC).timestamp() * 1000)
                        stats["received"] += 1
                        try:
                            queue.put_nowait((msg.topic, broker_received_at_ms, msg.payload))
                        except asyncio.QueueFull:
                            # Critical: never block the MQTT receive loop (broker will start dropping).
                            stats["dropped"] += 1
                    except Exception as e:  # noqa: BLE001
                        # Don't crash the service on a single bad message / transient DB error.
                        logger.exception("edge.message.processing_failed", topic=msg.topic, error=str(e))
                        stats["errors"] += 1
    except MqttError as e:
        logger.error("edge_ingest.mqtt_error", error=str(e))
        raise
    finally:
        try:
            stats_task.cancel()
        except Exception:  # noqa: BLE001
            pass
        for w in workers:
            w.cancel()
        await pool.close()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()

