import enum
import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class RoomStatus(enum.StrEnum):
    VACANT_CLEAN = "vacant_clean"
    VACANT_DIRTY = "vacant_dirty"
    OCCUPIED = "occupied"
    INSPECTED = "inspected"
    OUT_OF_ORDER = "out_of_order"


class RoomListItem(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    property_id: uuid.UUID

    room_number: str = Field(min_length=1, max_length=32)
    floor: int | None = None
    type: str | None = Field(default=None, max_length=64)
    status: RoomStatus

    current_reservation_id: uuid.UUID | None = None
    last_service_at: datetime | None = None
    vip: bool

    created_at: datetime
    updated_at: datetime


class RoomList(BaseModel):
    items: list[RoomListItem]


class GuestSummary(BaseModel):
    id: uuid.UUID
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)
    vip: bool
    language: str
    phone_e164: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=255)


class ReservationSummary(BaseModel):
    id: uuid.UUID
    guest_id: uuid.UUID
    property_id: uuid.UUID
    room_id: uuid.UUID | None = None
    status: str
    check_in_at: datetime
    check_out_at: datetime
    rate_cents: int | None = None
    group_id: str | None = Field(default=None, max_length=64)
    source: str | None = Field(default=None, max_length=64)

    guest: GuestSummary


class RoomDetail(BaseModel):
    room: RoomListItem
    current_reservation: ReservationSummary | None = None
    recent_incidents: list[dict] = Field(default_factory=list)


class RoomUpdate(BaseModel):
    status: RoomStatus | None = None
    attendant_user_id: uuid.UUID | None = None


class RoomCleaningLog(BaseModel):
    id: uuid.UUID
    room_id: uuid.UUID
    staff_name: str
    clean_type: str
    notes: str | None = None
    score_pct: int | None = None
    cleaned_at: datetime


class RoomCleaningLogList(BaseModel):
    items: list[RoomCleaningLog]
    total: int


class StayHistoryItem(BaseModel):
    reservation_id: uuid.UUID
    guest_first_name: str
    guest_last_name: str
    guest_vip: bool
    language: str
    nights: int
    check_in_at: datetime
    check_out_at: datetime
    rate_cents: int | None = None
    gss: float | None = None


class RoomStayHistory(BaseModel):
    items: list[StayHistoryItem]
    total: int

