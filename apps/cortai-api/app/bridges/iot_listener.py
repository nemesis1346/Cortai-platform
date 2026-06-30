"""
IoT bridge listener — background service that consumes bridge events
and republishes them into realtime.event_log so the frontend live socket
receives the documented event types:

    sensor.reading, hvac.state, elevator.state,
    people.count, device.status

Run as a standalone long-lived process:
    uv run python -m app.bridges.iot_listener

BRIDGES_MODE=mock (default):
    Replays fixture data (sensors, HVAC, elevators) on a timer.
    No external connection needed — same fixtures the HTTP mock uses.

BRIDGES_MODE=real:
    Opens a WebSocket to {IOT_BRIDGE_BASE_URL}/api/iot/v1/ws.
    Expects JSON frames: {"type": "<bridge-type>", "property_id": "...", ...}
    Bridge types are normalised to frontend taxonomy via _TYPE_MAP.

Environment knobs:
    IOT_LISTENER_INTERVAL_S   seconds between mock ticks (default: 5)
"""

from __future__ import annotations

import asyncio
import json
import os
import random
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import structlog
from sqlalchemy import text

from app.config import get_settings
from app.db import SessionLocal, set_current_org
from app.live.publisher import publish_live_event

log = structlog.get_logger(__name__)

_FIXTURES_DIR = Path(__file__).parent / "_fixtures"

# Map bridge-side event types → frontend taxonomy.
# Bridge may use either dotted or underscored names; both are handled.
_TYPE_MAP: dict[str, str] = {
    "sensor.reading": "sensor.reading",
    "sensor_reading": "sensor.reading",
    "hvac.state": "hvac.state",
    "hvac_state": "hvac.state",
    "hvac_update": "hvac.state",
    "elevator.state": "elevator.state",
    "elevator_state": "elevator.state",
    "elevator_update": "elevator.state",
    "people.count": "people.count",
    "people_count": "people.count",
    "occupancy": "people.count",
    "device.status": "device.status",
    "device_status": "device.status",
    "device_update": "device.status",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_fixture(name: str) -> Any:
    return json.loads((_FIXTURES_DIR / name).read_text(encoding="utf-8"))


def _jitter(value: float, scale: float = 0.3) -> float:
    """Add small Gaussian noise so mock readings look live."""
    return round(value + random.gauss(0, scale), 2)  # noqa: S311


async def _active_properties() -> list[dict[str, str]]:
    """Return all active (org_id, property_id) rows."""
    async with SessionLocal() as session:
        rows = await session.execute(
            text("select id, org_id from properties where status = 'active' order by created_at")
        )
        return [{"id": str(r.id), "org_id": str(r.org_id)} for r in rows]


async def _all_properties() -> dict[str, str]:
    """Return property_id → org_id map (for real-mode lookup)."""
    async with SessionLocal() as session:
        rows = await session.execute(text("select id, org_id from properties"))
        return {str(r.id): str(r.org_id) for r in rows}


# ---------------------------------------------------------------------------
# Mock loop
# ---------------------------------------------------------------------------


async def _mock_loop() -> None:
    sensors = _load_fixture("iot_sensors.json")
    hvac_rooms = _load_fixture("iot_hvac_rooms.json")
    elevators = _load_fixture("iot_elevators.json")
    interval = float(os.getenv("IOT_LISTENER_INTERVAL_S", "5"))
    tick = 0

    log.info("iot_listener.mock.started", interval_s=interval)

    while True:
        await asyncio.sleep(interval)
        tick += 1

        properties = await _active_properties()
        if not properties:
            log.warning("iot_listener.mock.no_active_properties")
            continue

        for prop in properties:
            org_id = prop["org_id"]
            property_id = prop["id"]

            try:
                async with SessionLocal() as session:
                    # RLS requires app.current_org_id before any DML.
                    await set_current_org(session, org_id)

                    # sensor.reading — rotate through all fixture sensors
                    sensor = sensors[tick % len(sensors)]
                    raw_value = sensor.get("value", 0)
                    await publish_live_event(
                        session,
                        {
                            "type": "sensor.reading",
                            "org_id": org_id,
                            "property_id": property_id,
                            "device_id": sensor["device_id"],
                            "room": sensor.get("room"),
                            "sensor_type": sensor["type"],
                            "value": (
                                _jitter(float(raw_value))
                                if isinstance(raw_value, (int, float))
                                else raw_value
                            ),
                            "unit": sensor.get("unit"),
                            "status": sensor.get("status", "online"),
                            "ts": datetime.now(UTC).isoformat(),
                        },
                    )

                    # hvac.state — rotate through fixture rooms
                    hvac = hvac_rooms[tick % len(hvac_rooms)]
                    await publish_live_event(
                        session,
                        {
                            "type": "hvac.state",
                            "org_id": org_id,
                            "property_id": property_id,
                            "room_id": hvac.get("room_id"),
                            "current_temp_c": _jitter(
                                float(hvac.get("current_temp_c", 22.0)), scale=0.1
                            ),
                            "target_temp_c": hvac.get("target_temp_c"),
                            "mode": hvac.get("mode"),
                            "fan_speed": hvac.get("fan_speed"),
                            "fault_code": hvac.get("fault_code"),
                            "ts": datetime.now(UTC).isoformat(),
                        },
                    )

                    # elevator.state — every 3 ticks
                    if tick % 3 == 0:
                        elevator = elevators[(tick // 3) % len(elevators)]
                        await publish_live_event(
                            session,
                            {
                                "type": "elevator.state",
                                "org_id": org_id,
                                "property_id": property_id,
                                "elevator_id": elevator["id"],
                                "name": elevator.get("name"),
                                "status": elevator.get("status", "online"),
                                "direction": random.choice(["up", "down", "idle"]),  # noqa: S311
                                "current_floor": random.randint(1, 10),  # noqa: S311
                                "ts": datetime.now(UTC).isoformat(),
                            },
                        )

                    # people.count — every 5 ticks
                    if tick % 5 == 0:
                        await publish_live_event(
                            session,
                            {
                                "type": "people.count",
                                "org_id": org_id,
                                "property_id": property_id,
                                "zone": "lobby",
                                "count": max(0, int(random.gauss(15, 5))),  # noqa: S311
                                "ts": datetime.now(UTC).isoformat(),
                            },
                        )

                    # device.status — every 10 ticks
                    if tick % 10 == 0:
                        dev = sensors[(tick // 10) % len(sensors)]
                        await publish_live_event(
                            session,
                            {
                                "type": "device.status",
                                "org_id": org_id,
                                "property_id": property_id,
                                "device_id": dev["device_id"],
                                "status": dev.get("status", "online"),
                                "ts": datetime.now(UTC).isoformat(),
                            },
                        )

                    await session.commit()

            except Exception:  # noqa: BLE001
                log.exception(
                    "iot_listener.mock.publish_error",
                    org_id=org_id,
                    property_id=property_id,
                    tick=tick,
                )

        log.debug("iot_listener.mock.tick", tick=tick, properties=len(properties))


# ---------------------------------------------------------------------------
# Real mode loop
# ---------------------------------------------------------------------------


async def _real_loop(base_url: str) -> None:
    try:
        from websockets.asyncio.client import connect  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError(
            "websockets package required for real bridge mode. Run: uv add websockets"
        ) from exc

    ws_url = (
        base_url.rstrip("/")
        .replace("http://", "ws://")
        .replace("https://", "wss://")
        + "/api/iot/v1/ws"
    )
    log.info("iot_listener.real.connecting", url=ws_url)

    while True:
        try:
            prop_map = await _all_properties()

            async with connect(ws_url) as ws:
                log.info("iot_listener.real.connected")

                async for raw in ws:
                    try:
                        event: dict[str, Any] = json.loads(raw)
                    except (json.JSONDecodeError, ValueError):
                        continue

                    frontend_type = _TYPE_MAP.get(str(event.get("type", "")))
                    if not frontend_type:
                        continue

                    property_id = str(event.get("property_id", ""))
                    org_id = prop_map.get(property_id)
                    if not org_id or not property_id:
                        log.debug(
                            "iot_listener.real.unknown_property",
                            property_id=property_id,
                        )
                        continue

                    try:
                        async with SessionLocal() as session:
                            await set_current_org(session, org_id)
                            await publish_live_event(
                                session,
                                {
                                    **event,
                                    "type": frontend_type,
                                    "org_id": org_id,
                                    "property_id": property_id,
                                },
                            )
                            await session.commit()
                    except Exception:  # noqa: BLE001
                        log.exception(
                            "iot_listener.real.publish_error",
                            frontend_type=frontend_type,
                            property_id=property_id,
                        )

        except Exception:  # noqa: BLE001
            log.warning("iot_listener.real.disconnected", url=ws_url)
            await asyncio.sleep(5)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def main() -> None:
    settings = get_settings()
    if settings.bridges_mode == "real":
        if not settings.iot_bridge_base_url:
            raise RuntimeError("IOT_BRIDGE_BASE_URL must be set when BRIDGES_MODE=real")
        await _real_loop(settings.iot_bridge_base_url)
    else:
        await _mock_loop()


if __name__ == "__main__":
    asyncio.run(main())