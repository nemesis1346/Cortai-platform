import enum
import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class ShiftLabel(enum.StrEnum):
    MORNING = "morning"
    AFTERNOON = "afternoon"
    NIGHT = "night"


class ShiftHandoverRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    property_id: uuid.UUID
    shift_date: date
    shift_label: ShiftLabel

    summary_md: str | None = None
    checklist_json: dict[str, Any] = Field(default_factory=dict)
    signed_by_user_id: uuid.UUID | None = None
    signed_at: datetime | None = None
    carry_forward_from_id: uuid.UUID | None = None

    created_at: datetime
    updated_at: datetime


class ShiftHandoverCurrent(BaseModel):
    property_id: uuid.UUID
    shift_date: date
    shift_label: ShiftLabel
    handover: ShiftHandoverRead | None = None

