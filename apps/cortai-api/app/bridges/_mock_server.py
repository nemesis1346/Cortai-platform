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


@mock_app.get("/api/ai/v1/operations/insights")
async def mock_ai_operations_insights(locale: str = Query(default="en")) -> Any:
    fixture_locale = "fr" if locale.lower().startswith("fr") else "en"
    return load_fixture(f"ai_operations_insights.{fixture_locale}.json")

