import enum
import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class GuestServiceType(enum.StrEnum):
    TOWELS = "towels"
    PILLOWS = "pillows"
    AMENITIES = "amenities"
    LATE_CHECKOUT = "late_checkout"
    WAKE_UP = "wake_up"
    OTHER = "other"


class GuestServiceStatus(enum.StrEnum):
    PENDING = "pending"
    ASSIGNED = "assigned"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class GuestServiceRequestItem(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    property_id: uuid.UUID
    room_id: uuid.UUID | None = None
    guest_id: uuid.UUID | None = None

    type: GuestServiceType
    status: GuestServiceStatus
    note: str | None = Field(default=None, max_length=500)
    assigned_to_user_id: uuid.UUID | None = None
    completed_at: datetime | None = None

    created_at: datetime
    updated_at: datetime


class GuestServiceRequestList(BaseModel):
    items: list[GuestServiceRequestItem]


class GuestServiceRequestCreate(BaseModel):
    property_id: uuid.UUID
    room_id: uuid.UUID | None = None
    guest_id: uuid.UUID | None = None
    type: GuestServiceType
    note: str | None = Field(default=None, max_length=500)

