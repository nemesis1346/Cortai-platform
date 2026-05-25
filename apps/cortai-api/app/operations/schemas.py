from pydantic import BaseModel, Field


class OperationsKpis(BaseModel):
    occupancy_pct: float = Field(ge=0, le=100)
    arrivals_today: int = Field(ge=0)
    departures_today: int = Field(ge=0)
    revenue_today: float = Field(ge=0)
    open_incidents: int = Field(ge=0)
    hk_progress_pct: float = Field(ge=0, le=100)

