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

