from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, status

FIXTURES_DIR = Path(__file__).parent / "_fixtures"


def load_fixture(name: str) -> Any:
    path = FIXTURES_DIR / name
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Missing bridge fixture: {name}",
        )
    return json.loads(path.read_text(encoding="utf-8"))


mock_app = FastAPI(title="COrtai Bridge Mock")


@mock_app.get("/api/iot/v1/elevators")
async def mock_iot_elevators() -> Any:
    return load_fixture("iot_elevators.json")


@mock_app.get("/api/iot/v1/hvac/rooms")
async def mock_iot_hvac_rooms() -> Any:
    return load_fixture("iot_hvac_rooms.json")


@mock_app.post("/api/iot/v1/hvac/rooms/{room_id}/control")
async def mock_iot_hvac_room_control(room_id: str) -> Any:
    room_id  # ignored in mock
    return load_fixture("iot_hvac_room_control.json")


@mock_app.get("/api/iot/v1/hvac/rooms/{room_id}/commands/{command_id}")
async def mock_iot_hvac_command_ack(room_id: str, command_id: str) -> Any:
    room_id, command_id  # ignored in mock
    return load_fixture("iot_hvac_command_ack.json")


@mock_app.get("/api/iot/v1/edge-events")
async def mock_iot_edge_events(type: str | None = Query(default=None)) -> Any:  # noqa: A002
    if (type or "").strip().lower() == "hvac_fault":
        return load_fixture("iot_edge_events_hvac_fault.json")
    # Minimal fallback fixture for other types.
    return []


@mock_app.get("/api/ai/v1/operations/insights")
async def mock_ai_operations_insights(locale: str = Query(default="en")) -> Any:
    fixture_locale = "fr" if locale.lower().startswith("fr") else "en"
    return load_fixture(f"ai_operations_insights.{fixture_locale}.json")


@mock_app.post("/api/ai/v1/incidents/{incident_id}/triage")
async def mock_ai_incident_triage(incident_id: str, locale: str = Query(default="en")) -> Any:
    fixture_locale = "fr" if locale.lower().startswith("fr") else "en"
    return load_fixture(f"ai_incident_triage.{fixture_locale}.json")

