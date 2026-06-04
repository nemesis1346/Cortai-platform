import uuid

from pydantic import BaseModel, Field


class OperationsHeader(BaseModel):
    property_id: uuid.UUID
    ai_live: bool
    occupancy_pct: float = Field(ge=0, le=100)
    active_alerts: int = Field(ge=0)
    rating: float = Field(ge=0, le=5)

