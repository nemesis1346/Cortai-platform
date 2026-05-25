import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.dependencies import get_principal
from app.auth.schemas import Principal
from app.main import create_app
from app.models import UserRole


def _client_for_org(*, org_id: uuid.UUID) -> AsyncClient:
    app = create_app()

    async def override_principal() -> Principal:
        return Principal(user_id=uuid.uuid4(), org_id=org_id, email="user@example.com", role=UserRole.STAFF)

    app.dependency_overrides[get_principal] = override_principal
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_operations_kpis_returns_expected_shape() -> None:
    org_id = uuid.uuid4()
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get("/api/operations/kpis")

    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {
        "occupancy_pct",
        "arrivals_today",
        "departures_today",
        "revenue_today",
        "open_incidents",
        "hk_progress_pct",
    }
    assert 0 <= body["occupancy_pct"] <= 100
    assert 0 <= body["hk_progress_pct"] <= 100
    assert body["arrivals_today"] >= 0
    assert body["departures_today"] >= 0
    assert body["open_incidents"] >= 0
    assert body["revenue_today"] >= 0

