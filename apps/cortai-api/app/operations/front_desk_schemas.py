from pydantic import BaseModel, Field


class FrontDeskStats(BaseModel):
    served_today: int = Field(ge=0)
    in_queue_now: int = Field(ge=0)
    queue_avg_seconds: float = Field(ge=0)
    checkin_avg_seconds: float = Field(ge=0)

