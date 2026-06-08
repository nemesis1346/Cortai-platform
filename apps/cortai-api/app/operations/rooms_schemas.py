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

