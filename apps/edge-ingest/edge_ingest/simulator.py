from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import ssl
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import structlog
from aiomqtt import Client
from paho.mqtt import client as paho_mqtt  # type: ignore[import-untyped]

logger = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class SimConfig:
    host: str
    port: int
    org: str
    property: str
    devices: int
    device_prefix: str
    device_start: int
    rate: float
    duration_s: float
    schema_version: str
    types: tuple[str, ...]
    insecure_no_tls: bool
    ca_file: str | None
    client_cert: str | None
    client_key: str | None
    qos: int
    connections: int
    publish_timeout_s: float
    backend: str
    min_achieved_mps: float | None


def _rfc3339_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _topic(*, org: str, prop: str, device_id: str, msg_type: str) -> str:
    return f"cortai/{org}/{prop}/edge/{device_id}/{msg_type}"


def _envelope(*, device_id: str, msg_type: str, schema_version: str) -> dict[str, Any]:
    # Matches apps/cortai-api/schemas/edge_message_envelope.schema.json
    payload: dict[str, Any]
    if msg_type == "detection":
        payload = {
            "kind": "person",
            "score": round(random.uniform(0.5, 0.99), 3),  # noqa: S311
            "zone": random.choice(["lobby", "pool", "garage", "hall"]),  # noqa: S311
        }
    elif msg_type == "telemetry":
        payload = {
            "temp_c": round(random.uniform(18.0, 32.0), 2),  # noqa: S311
            "humidity": random.randint(25, 70),  # noqa: S311
        }
    elif msg_type == "health":
        payload = {"kind": "heartbeat", "uptime_s": random.randint(10, 100_000)}  # noqa: S311
    else:  # event
        payload = {"kind": "edge_event", "message": "synthetic"}

    return {
        "device_id": device_id,
        "ts": _rfc3339_now(),
        "type": msg_type,
        "schema_version": schema_version,
        "payload": payload,
    }


def _ssl_context(
    *,
    ca_file: str,
    client_cert: str | None,
    client_key: str | None,
) -> ssl.SSLContext:
    ctx = ssl.create_default_context(ssl.Purpose.SERVER_AUTH, cafile=ca_file)
    if client_cert and client_key:
        ctx.load_cert_chain(certfile=client_cert, keyfile=client_key)
    # Keep consistent with production broker settings.
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    return ctx


async def _publisher_task(
    cfg: SimConfig,
    *,
    connection_idx: int,
    device_ids: list[str],
) -> tuple[int, float]:
    tls_ctx: ssl.SSLContext | None = None
    if not cfg.insecure_no_tls:
        if not cfg.ca_file:
            raise RuntimeError("CA file is required unless --insecure-no-tls is set")
        tls_ctx = _ssl_context(
            ca_file=cfg.ca_file, client_cert=cfg.client_cert, client_key=cfg.client_key
        )

    # Token-bucket style pacing.
    #
    # CI note: measure achieved_mps over the publish window only (exclude connect/setup time),
    # otherwise short tests flake on slower runners.
    per_conn_rate = cfg.rate / max(cfg.connections, 1)
    interval = 1.0 / per_conn_rate if per_conn_rate > 0 else 0.0

    sent = 0

    async with Client(
        hostname=cfg.host,
        port=cfg.port,
        tls_context=tls_ctx,
        identifier=f"cortai-sim-{int(time.time() * 1000)}-{os.getpid()}-{connection_idx}",
        protocol=paho_mqtt.MQTTv311,
    ) as client:
        publish_start = time.monotonic()
        end = publish_start + cfg.duration_s
        logger.info(
            "sim.connected",
            host=cfg.host,
            port=cfg.port,
            org=cfg.org,
            property=cfg.property,
            devices=len(device_ids),
            rate=per_conn_rate,
            duration_s=cfg.duration_s,
            insecure_no_tls=cfg.insecure_no_tls,
            qos=cfg.qos,
            connection_idx=connection_idx,
            connections=cfg.connections,
        )

        next_send = publish_start
        while time.monotonic() < end:
            now = time.monotonic()
            if interval and now < next_send:
                await asyncio.sleep(min(0.05, next_send - now))
                continue

            device_id = random.choice(device_ids)  # noqa: S311
            msg_type = random.choice(cfg.types)  # noqa: S311
            env = _envelope(
                device_id=device_id,
                msg_type=msg_type,
                schema_version=cfg.schema_version,
            )
            topic = _topic(org=cfg.org, prop=cfg.property, device_id=device_id, msg_type=msg_type)
            payload = json.dumps(env).encode("utf-8")

            try:
                if cfg.qos == 0:
                    # QoS0: do not wait for any ack.
                    await client.publish(topic, payload, qos=0)
                else:
                    # QoS1: PUBACK required.
                    await client.publish(topic, payload, qos=1, timeout=cfg.publish_timeout_s)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "sim.publish_failed",
                    error=str(exc),
                    qos=cfg.qos,
                    connection_idx=connection_idx,
                    hint="try --qos 0 and/or increase --connections and/or lower --rate",
                )
                raise
            sent += 1
            next_send += interval

        publish_end = time.monotonic()
        elapsed = publish_end - publish_start
        achieved = sent / max(elapsed, 1e-9)
        logger.info(
            "sim.done",
            sent=sent,
            elapsed_s=round(elapsed, 3),
            achieved_mps=round(achieved, 2),
            connection_idx=connection_idx,
        )
        return sent, elapsed


def _publisher_paho(cfg: SimConfig, *, device_ids: list[str]) -> tuple[int, float]:
    """
    High-throughput backend.

    `aiomqtt` is great for correctness, but it still waits on internal confirmations
    and can time out even at QoS0 under high rates. For NFR-PERF-02 load, paho in
    loop_start + fire-and-forget publish is the simplest way to generate sustained load.
    """

    if cfg.connections != 1:
        # Mosquitto in this repo uses `use_username_as_clientid true`, which forces the
        # client id to be the username (client cert identity). With a single cert, multiple
        # concurrent connections will continually disconnect each other.
        raise RuntimeError(
            "connections>1 is not supported with current Mosquitto settings; "
            "use --connections 1, or disable use_username_as_clientid, or use multiple certs."
        )

    tls_ctx: ssl.SSLContext | None = None
    if not cfg.insecure_no_tls:
        if not cfg.ca_file:
            raise RuntimeError("CA file is required unless --insecure-no-tls is set")
        tls_ctx = _ssl_context(
            ca_file=cfg.ca_file, client_cert=cfg.client_cert, client_key=cfg.client_key
        )

    interval = 1.0 / cfg.rate if cfg.rate > 0 else 0.0
    sent = 0

    client = paho_mqtt.Client(
        client_id=f"cortai-sim-{int(time.time() * 1000)}-{os.getpid()}",
        protocol=paho_mqtt.MQTTv311,
    )
    connected = threading.Event()
    connect_rc: list[int] = []

    def _on_connect(_client, _userdata, _flags, rc, _properties=None):  # type: ignore[no-untyped-def]
        connect_rc.append(int(rc))
        if rc == 0:
            connected.set()

    client.on_connect = _on_connect

    if tls_ctx is not None:
        # paho expects file paths, not an SSLContext
        client.tls_set(
            ca_certs=cfg.ca_file,
            certfile=cfg.client_cert,
            keyfile=cfg.client_key,
        )

    # Use async (background) network loop.
    client.loop_start()
    try:
        # Use connect_async so we can wait for handshake completion before publishing.
        client.connect_async(cfg.host, cfg.port, keepalive=30)
        if not connected.wait(timeout=10.0):
            rc = connect_rc[-1] if connect_rc else None
            raise RuntimeError(f"failed to connect to broker (rc={rc})")

        # Allow unlimited queueing by default; this is a load generator.
        try:
            client.max_queued_messages_set(0)
        except Exception:  # noqa: BLE001, S110
            pass

        logger.info(
            "sim.connected",
            host=cfg.host,
            port=cfg.port,
            org=cfg.org,
            property=cfg.property,
            devices=len(device_ids),
            rate=cfg.rate,
            duration_s=cfg.duration_s,
            insecure_no_tls=cfg.insecure_no_tls,
            qos=cfg.qos,
            backend="paho",
        )

        publish_start = time.monotonic()
        end = publish_start + cfg.duration_s

        next_send = publish_start
        while time.monotonic() < end:
            now = time.monotonic()
            if interval and now < next_send:
                time.sleep(min(0.01, next_send - now))
                continue

            device_id = random.choice(device_ids)  # noqa: S311
            msg_type = random.choice(cfg.types)  # noqa: S311
            env = _envelope(
                device_id=device_id,
                msg_type=msg_type,
                schema_version=cfg.schema_version,
            )
            topic = _topic(org=cfg.org, prop=cfg.property, device_id=device_id, msg_type=msg_type)
            payload = json.dumps(env).encode("utf-8")

            # Fire-and-forget publish; rc is immediate local result.
            info = client.publish(topic, payload, qos=cfg.qos)
            if info.rc != 0:
                raise RuntimeError(
                    f"publish failed rc={info.rc} (likely disconnected/backpressure)"
                )
            sent += 1
            next_send += interval
        publish_end = time.monotonic()
        elapsed = publish_end - publish_start
        logger.info(
            "sim.done",
            sent=sent,
            elapsed_s=round(elapsed, 3),
            achieved_mps=round(sent / max(elapsed, 1e-9), 2),
        )
        return sent, elapsed
    finally:
        client.loop_stop()
        client.disconnect()


def _parse_args(argv: list[str] | None = None) -> SimConfig:
    p = argparse.ArgumentParser(description="COrtai device simulator (NFR-PERF-02)")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8883)
    p.add_argument("--org", required=True)
    p.add_argument("--property", dest="prop", required=True)
    p.add_argument("--devices", type=int, default=10)
    p.add_argument(
        "--device-prefix",
        default="sim",
        help="Device id prefix (default: sim).",
    )
    p.add_argument(
        "--device-start",
        type=int,
        default=1,
        help="Starting index for generated device ids (default: 1).",
    )
    p.add_argument(
        "--rate",
        type=float,
        default=100.0,
        help="Messages per second total (across all devices).",
    )
    p.add_argument("--duration-s", type=float, default=30.0)
    p.add_argument("--schema-version", default="1.0")
    p.add_argument(
        "--types",
        default="health",
        help="Comma-separated: detection,telemetry,health,event",
    )
    p.add_argument("--qos", type=int, default=0, choices=[0, 1])
    p.add_argument(
        "--backend",
        default="paho",
        choices=["paho", "aiomqtt", "asyncio-mqtt"],
        help=(
            "Publish backend; use paho for high-throughput load generation. "
            "`asyncio-mqtt` is an alias for aiomqtt."
        ),
    )
    p.add_argument(
        "--connections",
        type=int,
        default=1,
        help="Number of concurrent MQTT connections (rate is split evenly).",
    )
    p.add_argument(
        "--publish-timeout-s",
        type=float,
        default=10.0,
        help="Timeout for publish confirmation (QoS=1 only; QoS=0 is fire-and-forget).",
    )
    p.add_argument(
        "--min-achieved-mps",
        type=float,
        default=None,
        help="If set, exit non-zero unless achieved_mps is >= this value.",
    )

    p.add_argument("--insecure-no-tls", action="store_true", help="Use plain MQTT (no TLS).")
    p.add_argument("--ca-file", default=None)
    p.add_argument("--client-cert", default=None)
    p.add_argument("--client-key", default=None)

    args = p.parse_args(argv)
    types = tuple(t.strip() for t in str(args.types).split(",") if t.strip())
    if not types:
        raise SystemExit("--types must not be empty")
    for t in types:
        if t not in {"detection", "telemetry", "health", "event"}:
            raise SystemExit(f"invalid type: {t}")

    ca_file = str(Path(args.ca_file)) if args.ca_file else None
    client_cert = str(Path(args.client_cert)) if args.client_cert else None
    client_key = str(Path(args.client_key)) if args.client_key else None

    return SimConfig(
        host=str(args.host),
        port=int(args.port),
        org=str(args.org),
        property=str(args.prop),
        devices=int(args.devices),
        device_prefix=str(args.device_prefix),
        device_start=int(args.device_start),
        rate=float(args.rate),
        duration_s=float(args.duration_s),
        schema_version=str(args.schema_version),
        types=types,
        insecure_no_tls=bool(args.insecure_no_tls),
        ca_file=ca_file,
        client_cert=client_cert,
        client_key=client_key,
        qos=int(args.qos),
        connections=int(args.connections),
        publish_timeout_s=float(args.publish_timeout_s),
        backend=str(args.backend),
        min_achieved_mps=(
            float(args.min_achieved_mps) if args.min_achieved_mps is not None else None
        ),
    )


def main(argv: list[str] | None = None) -> None:
    cfg = _parse_args(argv)
    start = cfg.device_start
    device_ids = [f"{cfg.device_prefix}-{i:04d}" for i in range(start, start + cfg.devices)]
    if cfg.backend == "paho":
        sent, elapsed = _publisher_paho(cfg, device_ids=device_ids)
        achieved = sent / max(elapsed, 1e-9)
        if cfg.min_achieved_mps is not None and achieved < cfg.min_achieved_mps:
            raise SystemExit(
                f"achieved_mps {achieved:.2f} < min_achieved_mps {cfg.min_achieved_mps:.2f}"
            )
        return

    shards: list[list[str]] = [[] for _ in range(max(cfg.connections, 1))]
    for i, did in enumerate(device_ids):
        shards[i % len(shards)].append(did)

    async def _run_aiomqtt() -> None:
        tasks = [
            _publisher_task(cfg, connection_idx=i, device_ids=shards[i])
            for i in range(len(shards))
        ]
        start = time.monotonic()
        results = cast(
            list[tuple[int, float] | BaseException],
            await asyncio.gather(*tasks, return_exceptions=True),
        )
        elapsed = time.monotonic() - start

        total_sent = 0
        failures = 0
        for r in results:
            if isinstance(r, BaseException):
                failures += 1
                logger.error("sim.connection_failed", error=str(r))
                continue
            sent, _conn_elapsed = r
            total_sent += sent

        logger.info(
            "sim.total",
            backend="aiomqtt",
            connections=cfg.connections,
            total_sent=total_sent,
            failures=failures,
            elapsed_s=round(elapsed, 3),
            achieved_mps=round(total_sent / max(elapsed, 1e-9), 2),
            qos=cfg.qos,
        )
        achieved = total_sent / max(elapsed, 1e-9)
        if cfg.min_achieved_mps is not None and achieved < cfg.min_achieved_mps:
            raise SystemExit(
                f"achieved_mps {achieved:.2f} < min_achieved_mps {cfg.min_achieved_mps:.2f}"
            )

    asyncio.run(_run_aiomqtt())


if __name__ == "__main__":
    main()

