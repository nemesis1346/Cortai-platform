from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class MeetingRoomRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    property_id: uuid.UUID
    name: str = Field(min_length=1, max_length=180)
    capacity: int = Field(ge=0)
    equipment: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class MeetingRoomList(BaseModel):
    items: list[MeetingRoomRead]


class MeetingRoomCreate(BaseModel):
    property_id: uuid.UUID
    name: str = Field(min_length=1, max_length=180)
    capacity: int = Field(ge=0)
    equipment: list[str] = Field(default_factory=list)


class MeetingRoomUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=180)
    capacity: int | None = Field(default=None, ge=0)
    equipment: list[str] | None = None


class MeetingBookingRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    property_id: uuid.UUID
    meeting_room_id: uuid.UUID
    organizer_guest_id_or_user_id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=240)
    attendees_count: int | None = Field(default=None, ge=0)
    starts_at: datetime
    ends_at: datetime
    setup_status: str = Field(min_length=1, max_length=32)
    created_at: datetime
    updated_at: datetime


class MeetingBookingList(BaseModel):
    items: list[MeetingBookingRead]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)


class MeetingBookingCreate(BaseModel):
    property_id: uuid.UUID
    meeting_room_id: uuid.UUID
    organizer_guest_id_or_user_id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=240)
    attendees_count: int | None = Field(default=None, ge=0)
    starts_at: datetime
    ends_at: datetime
    setup_status: str = Field(default="setup", min_length=1, max_length=32)


class MeetingBookingUpdate(BaseModel):
    meeting_room_id: uuid.UUID | None = None
    organizer_guest_id_or_user_id: uuid.UUID | None = None
    title: str | None = Field(default=None, max_length=240)
    attendees_count: int | None = Field(default=None, ge=0)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    setup_status: str | None = Field(default=None, max_length=32)

