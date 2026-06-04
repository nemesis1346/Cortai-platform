from pydantic import BaseModel, Field


class HousekeepingSummary(BaseModel):
    rooms_assigned: int = Field(ge=0)
    staff_count: int = Field(ge=0)
    avg_per_staff: float = Field(ge=0)
    done_pct: float = Field(ge=0, le=100)
    efficiency_pct: float = Field(ge=0, le=100)
    avg_clean_seconds: float = Field(ge=0)

    in_process: int = Field(ge=0)
    in_transit: int = Field(ge=0)
    on_break: int = Field(ge=0)
    dnd: int = Field(ge=0)

