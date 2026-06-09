import enum
import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class ShiftLabel(enum.StrEnum):
    MORNING = "morning"
    AFTERNOON = "afternoon"
    NIGHT = "night"


class ShiftHandoverSignoffRequest(BaseModel):
    property_id: uuid.UUID
    shift_date: date | None = None
    shift_label: ShiftLabel | None = None

    # Snapshot of KPIs + open items at sign-off time.
    summary_md: str | None = None
    checklist_json: dict[str, Any] = Field(default_factory=dict)

    # If true, create the next shift record (carry-forward).
    start_next: bool = True

    # Optional overrides for the newly created next shift record.
    next_summary_md: str | None = None
    next_checklist_json: dict[str, Any] | None = None


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


class ShiftHandoverSignoffResponse(BaseModel):
    signed: ShiftHandoverRead
    next: ShiftHandoverRead | None = None


class ShiftHandoverUpdate(BaseModel):
    summary_md: str | None = None
    checklist_json: dict[str, Any] | None = None


class ShiftHandoverHistoryList(BaseModel):
    items: list[ShiftHandoverRead]

