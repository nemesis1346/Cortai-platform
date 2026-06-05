from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException, Request, status

from app.bridges._mock_server import load_fixture
from app.config import get_settings


async def get_elevators(request: Request) -> Any:
    settings = get_settings()
    mode = settings.bridges_mode.lower().strip()
    if mode == "mock":
        return load_fixture("iot_elevators.json")
    if mode != "real":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Invalid BRIDGES_MODE",
        )
    if not settings.iot_bridge_base_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="IOT_BRIDGE_BASE_URL not set",
        )

    headers = _forward_headers(request)
    timeout = httpx.Timeout(10.0, connect=5.0)
    async with httpx.AsyncClient(base_url=settings.iot_bridge_base_url, timeout=timeout) as client:
        resp = await client.get(
            "/api/iot/v1/elevators",
            params=dict(request.query_params),
            headers=headers,
        )
    return _decode_json_response(resp)


def _forward_headers(request: Request) -> dict[str, str]:
    cookie = request.headers.get("cookie")
    return {"cookie": cookie} if cookie else {}


def _decode_json_response(resp: httpx.Response) -> Any:
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()

