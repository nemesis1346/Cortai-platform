from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException, Request, status

from app.config import get_settings


async def dispatch_outbound_message(*, request: Request, payload: dict[str, Any]) -> Any:
    """
    Calls the internal messaging dispatch endpoint.

    This is intentionally factored into its own function so tests can override it
    without mocking httpx internals.
    """
    cookie = request.headers.get("cookie")
    headers = {"cookie": cookie} if cookie else {}
    settings = get_settings()
    timeout = httpx.Timeout(15.0, connect=5.0)
    base_url = (
        str(settings.internal_messaging_base_url).rstrip("/")
        if settings.internal_messaging_base_url
        else str(request.base_url).rstrip("/")
    )
    try:
        async with httpx.AsyncClient(base_url=base_url, timeout=timeout) as client:
            resp = await client.post("/api/internal/messaging/dispatch", json=payload, headers=headers)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Messaging dispatch unavailable at {base_url}",
        ) from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=resp.text)
    try:
        return resp.json()
    except Exception:  # noqa: BLE001
        return {"ok": True}

