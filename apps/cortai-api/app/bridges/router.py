from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from app.bridges import ai_client, iot_client

router = APIRouter(tags=["bridges"])


@router.get("/api/iot/v1/elevators")
async def get_iot_elevators(request: Request) -> Any:
    return await iot_client.get_elevators(request)


@router.get("/api/ai/v1/operations/insights")
async def get_ai_operations_insights(request: Request) -> Any:
    return await ai_client.get_operations_insights(request)

