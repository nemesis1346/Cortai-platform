from __future__ import annotations

import asyncio
from datetime import UTC
from typing import Any

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


async def _check_mqtt(
    *, host: str, port: int, timeout_s: float
) -> dict[str, Any]:
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

    db_task = _check_db(session=session, timeout_s=timeout_s)
    redis_task = _check_redis(redis_url=settings.redis_url, timeout_s=timeout_s)
    mqtt_task = _check_mqtt(host=settings.mqtt_host, port=settings.mqtt_port, timeout_s=timeout_s)
    mqtt_last_seen_task = _mqtt_last_seen(session=session, timeout_s=timeout_s)

    db, redis, mqtt, mqtt_last_seen = await asyncio.gather(
        db_task, redis_task, mqtt_task, mqtt_last_seen_task
    )

    ok = bool(db.get("ok")) and bool(redis.get("ok")) and bool(mqtt.get("ok"))
    status = "ok" if ok else "degraded"

    return {
        "status": status,
        "db": {"ok": bool(db.get("ok")), "version": db.get("version")},
        "redis": {"ok": bool(redis.get("ok"))},
        "mqtt": {"ok": bool(mqtt.get("ok")), "last_seen": mqtt_last_seen},
        "build": {
            "sha": settings.build_sha or "unknown",
            "version": settings.build_version or "unknown",
        },
    }
