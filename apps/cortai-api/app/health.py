from __future__ import annotations

import asyncio
import time
from datetime import UTC
from typing import Any

import httpx
from fastapi import APIRouter
from sqlalchemy import text

from app.config import get_settings
from app.db import SessionDep

router = APIRouter(tags=["health"])


async def _check_db(*, session: SessionDep, timeout_s: float) -> dict[str, Any]:
    async def _run() -> dict[str, Any]:
        version = await session.scalar(text("select version()"))
        return {"ok": True, "version": str(version)}

    try:
        return await asyncio.wait_for(_run(), timeout=timeout_s)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "version": None, "error": str(exc)}


async def _check_redis(*, redis_url: str | None, timeout_s: float) -> dict[str, Any]:
    # If this service isn't configured to use Redis, treat it as healthy.
    # This keeps /api/health useful for CloudWatch alarms even in deployments
    # without Redis.
    if not redis_url:
        return {"ok": True}

    try:
        import redis.asyncio as redis  # type: ignore[import-not-found]
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"redis_client_unavailable: {exc}"}

    client = redis.from_url(redis_url, socket_connect_timeout=timeout_s, socket_timeout=timeout_s)

    async def _run() -> dict[str, Any]:
        pong = await client.ping()
        return {"ok": bool(pong)}

    try:
        return await asyncio.wait_for(_run(), timeout=timeout_s)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
    finally:
        try:
            await client.aclose()
        except Exception:  # noqa: BLE001
            pass


async def _check_mqtt(*, host: str, port: int, timeout_s: float) -> dict[str, Any]:
    try:

        async def _run() -> dict[str, Any]:
            # Intentionally a simple TCP connect only.
            # Our Mosquitto broker uses mTLS (8883); a full MQTT/TLS handshake from the API
            # would require shipping client certs/keys here. For alarm purposes, it's enough
            # to verify the broker port is accepting connections.
            reader, writer = await asyncio.open_connection(host=host, port=port)
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:  # noqa: BLE001
                pass
            _ = reader  # silence "unused" for mypy
            return {"ok": True}

        return await asyncio.wait_for(_run(), timeout=timeout_s)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


async def _check_bridge(*, mode: str, base_url: str | None, timeout_s: float) -> dict[str, Any]:
    """Check reachability of an IoT or AI bridge.

    Mock mode: exercised in-process via the mock FastAPI app (no network).
    Real mode: GET {base_url}/healthz — the documented health probe on each bridge.
    """
    t0 = time.monotonic()

    async def _run() -> None:
        if mode == "mock":
            from app.bridges._mock_server import (
                mock_app,  # local import avoids circular dep at module load
            )

            transport = httpx.ASGITransport(app=mock_app)  # type: ignore[arg-type]
            async with httpx.AsyncClient(transport=transport, base_url="http://mock") as client:
                resp = await client.get("/healthz")
                resp.raise_for_status()
        else:
            if not base_url:
                raise ValueError("bridge base URL not configured")
            async with httpx.AsyncClient(
                base_url=base_url, timeout=httpx.Timeout(timeout_s, connect=timeout_s)
            ) as client:
                resp = await client.get("/healthz")
                resp.raise_for_status()

    try:
        await asyncio.wait_for(_run(), timeout=timeout_s)
        return {"ok": True, "mode": mode, "latency_ms": round((time.monotonic() - t0) * 1000, 1)}
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "mode": mode,
            "latency_ms": round((time.monotonic() - t0) * 1000, 1),
            "error": str(exc),
        }


async def _check_s3(
    *,
    mode: str,
    bucket: str | None,
    region: str | None,
    endpoint_url: str | None,
    access_key: str | None,
    secret_key: str | None,
    timeout_s: float,
) -> dict[str, Any]:
    """Verify S3 is reachable and the configured bucket exists.

    Mock mode: returns immediately — no network call needed.
    Real mode: head_bucket call via boto3 (run in a thread to stay async-safe).
    """
    display_bucket = bucket or "mock-bucket"

    if mode == "mock":
        return {"ok": True, "bucket": display_bucket}

    if not bucket:
        return {"ok": False, "bucket": None, "error": "S3_BUCKET not set"}

    def _head_bucket() -> None:
        import boto3  # type: ignore[import-not-found]

        session = boto3.session.Session(
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
        )
        client = session.client("s3", endpoint_url=endpoint_url)
        client.head_bucket(Bucket=bucket)

    try:
        await asyncio.wait_for(asyncio.to_thread(_head_bucket), timeout=timeout_s)
        return {"ok": True, "bucket": bucket}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "bucket": bucket, "error": str(exc)}


async def _mqtt_last_seen(*, session: SessionDep, timeout_s: float) -> str | None:
    async def _run() -> str | None:
        # Best-effort "last seen" across any device (org-scoped by RLS when authenticated).
        ts = await session.scalar(text("select max(last_seen_at) from platform.devices"))
        if ts is None:
            return None
        try:
            # Ensure ISO 8601 with timezone.
            return ts.astimezone(UTC).isoformat()
        except Exception:  # noqa: BLE001
            return str(ts)

    try:
        return await asyncio.wait_for(_run(), timeout=timeout_s)
    except Exception:  # noqa: BLE001
        return None


@router.get("/api/health")
async def health(session: SessionDep) -> dict[str, Any]:
    settings = get_settings()
    timeout_s = settings.health_timeout_s

    db, redis, mqtt, mqtt_last_seen, iot_bridge, ai_bridge, s3 = await asyncio.gather(
        _check_db(session=session, timeout_s=timeout_s),
        _check_redis(redis_url=settings.redis_url, timeout_s=timeout_s),
        _check_mqtt(host=settings.mqtt_host, port=settings.mqtt_port, timeout_s=timeout_s),
        _mqtt_last_seen(session=session, timeout_s=timeout_s),
        _check_bridge(
            mode=settings.bridges_mode, base_url=settings.iot_bridge_base_url, timeout_s=timeout_s
        ),
        _check_bridge(
            mode=settings.bridges_mode, base_url=settings.ai_bridge_base_url, timeout_s=timeout_s
        ),
        _check_s3(
            mode=settings.s3_mode,
            bucket=settings.s3_bucket,
            region=settings.s3_region,
            endpoint_url=settings.s3_endpoint_url,
            access_key=settings.aws_access_key_id,
            secret_key=settings.aws_secret_access_key,
            timeout_s=timeout_s,
        ),
    )

    ok = (
        bool(db.get("ok"))
        and bool(redis.get("ok"))
        and bool(mqtt.get("ok"))
        and bool(iot_bridge.get("ok"))
        and bool(ai_bridge.get("ok"))
        and bool(s3.get("ok"))
    )

    return {
        "status": "ok" if ok else "degraded",
        "db": {"ok": bool(db.get("ok")), "version": db.get("version")},
        "redis": {"ok": bool(redis.get("ok"))},
        "mqtt": {"ok": bool(mqtt.get("ok")), "last_seen": mqtt_last_seen},
        "iot_bridge": iot_bridge,
        "ai_bridge": ai_bridge,
        "s3": s3,
        "build": {
            "sha": settings.build_sha or "unknown",
            "version": settings.build_version or "unknown",
        },
    }
