from __future__ import annotations

import asyncio
import json
import ssl
from datetime import UTC, datetime
from typing import Any

import structlog
from asyncio_mqtt import Client, MqttError
from paho.mqtt import client as paho_mqtt

from edge_ingest.config import get_settings
from edge_ingest.db import (
    connect,
    fetch_org_id_by_slug,
    fetch_property_id_by_slug,
    set_current_org,
)
from edge_ingest.logging import configure_logging
from edge_ingest.schema_validation import EdgeEnvelopeValidationError, validate_edge_envelope
from edge_ingest.topic import parse_edge_topic

logger = structlog.get_logger(__name__)


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
    conn, *, org_id: str, property_id: str, topic_type: str, message: dict[str, Any]
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

        # DE-08: Update device last-seen on any successfully validated message ingestion.
        # Use broker/server receive time to avoid device clock skew.
        last_seen_at = datetime.now(UTC)
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

    conn = await connect(settings.database_url)
    try:
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
                await client.subscribe(settings.mqtt_topic, qos=1)
                logger.info(
                    "edge_ingest.subscribed",
                    host=settings.mqtt_host,
                    port=settings.mqtt_port,
                    topic=settings.mqtt_topic,
                )

                async for msg in messages:
                    try:
                        broker_received_at_ms = int(datetime.now(UTC).timestamp() * 1000)
                        t = parse_edge_topic(msg.topic)

                        payload = json.loads(msg.payload.decode("utf-8"))
                        validate_edge_envelope(payload)
                        logger.info(
                            "edge.message.received",
                            topic=msg.topic,
                            device_id=payload.get("device_id"),
                            msg_type=payload.get("type"),
                        )

                        # Cross-check: topic must match envelope
                        if payload.get("device_id") != t.device_id or payload.get("type") != t.msg_type:
                            logger.warning(
                                "edge.payload.topic_mismatch",
                                topic=msg.topic,
                                org=t.org,
                                property=t.property,
                                topic_device_id=t.device_id,
                                topic_type=t.msg_type,
                                envelope_device_id=payload.get("device_id"),
                                envelope_type=payload.get("type"),
                            )
                            continue

                        org_id = await fetch_org_id_by_slug(conn, t.org)
                        if org_id is None:
                            logger.warning("edge.unknown_org", org=t.org, topic=msg.topic)
                            continue

                        property_id = await fetch_property_id_by_slug(
                            conn, org_id=org_id, property_slug=t.property
                        )
                        if property_id is None:
                            logger.warning(
                                "edge.unknown_property",
                                org=t.org,
                                property=t.property,
                                topic=msg.topic,
                            )
                            continue

                        await _persist_message(
                            conn,
                            org_id=org_id,
                            property_id=property_id,
                            topic_type=t.msg_type,
                            message={**payload, "_broker_received_at_ms": broker_received_at_ms},
                        )
                    except EdgeEnvelopeValidationError as e:
                        logger.warning(
                            "edge.payload.schema_rejected",
                            topic=msg.topic,
                            errors=e.errors,
                        )
                    except ValueError as e:
                        logger.warning("edge.message.invalid", topic=msg.topic, error=str(e))
                    except Exception as e:  # noqa: BLE001
                        # Don't crash the service on a single bad message / transient DB error.
                        logger.exception("edge.message.processing_failed", topic=msg.topic, error=str(e))
    except MqttError as e:
        logger.error("edge_ingest.mqtt_error", error=str(e))
        raise
    finally:
        await conn.close()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()

