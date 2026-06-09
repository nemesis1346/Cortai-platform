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


@router.post("/api/ai/v1/incidents/{incident_id}/triage")
async def post_ai_incident_triage(incident_id: str, request: Request) -> Any:
    data = await request.json()
    # The AI bridge contract keys off the incident id in the path.
    data = {**data, "id": incident_id}
    return await ai_client.post_incident_triage(request=request, incident=data)

