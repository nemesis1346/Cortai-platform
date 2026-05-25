from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth.dependencies import PrincipalDep
from app.operations.schemas import OperationsKpis

router = APIRouter(prefix="/api/operations", tags=["operations"])
AuthedPrincipalDep = Annotated[PrincipalDep, Depends()]


def _stable_int(*, org_id: uuid.UUID, day: date, lo: int, hi: int) -> int:
    # Deterministic mock numbers (stable across restarts).
    seed = int(org_id) ^ int(day.strftime("%Y%m%d"))
    span = max(hi - lo + 1, 1)
    return lo + (seed % span)


@router.get("/kpis", response_model=OperationsKpis)
async def get_kpis(principal: PrincipalDep) -> OperationsKpis:
    """
    Week-2 mock KPI endpoint. Real PMS/ops integrations land week 3+.
    """
    today = datetime.now(UTC).date()

    arrivals = _stable_int(org_id=principal.org_id, day=today, lo=0, hi=18)
    departures = _stable_int(org_id=principal.org_id, day=today, lo=0, hi=18)
    open_incidents = _stable_int(org_id=principal.org_id, day=today, lo=0, hi=6)

    # Keep the mock values plausible and bounded.
    occupancy_pct = float(_stable_int(org_id=principal.org_id, day=today, lo=55, hi=96))
    hk_progress_pct = float(_stable_int(org_id=principal.org_id, day=today, lo=0, hi=100))
    revenue_today = float(_stable_int(org_id=principal.org_id, day=today, lo=5000, hi=45000))

    return OperationsKpis(
        occupancy_pct=occupancy_pct,
        arrivals_today=arrivals,
        departures_today=departures,
        revenue_today=revenue_today,
        open_incidents=open_incidents,
        hk_progress_pct=hk_progress_pct,
    )

