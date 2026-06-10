from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class FitnessClassRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    property_id: uuid.UUID
    name: str = Field(min_length=1, max_length=180)
    instructor_name: str | None = Field(default=None, max_length=180)
    starts_at: datetime
    ends_at: datetime
    capacity: int = Field(ge=0)
    booked: int = Field(ge=0)
    location: str | None = Field(default=None, max_length=180)
    description: str | None = Field(default=None, max_length=500)
    status: str = Field(min_length=1, max_length=32)
    created_at: datetime
    updated_at: datetime


class FitnessClassList(BaseModel):
    items: list[FitnessClassRead]


class FitnessClassCreate(BaseModel):
    property_id: uuid.UUID
    name: str = Field(min_length=1, max_length=180)
    instructor_name: str | None = Field(default=None, max_length=180)
    starts_at: datetime
    ends_at: datetime
    capacity: int = Field(ge=0)
    booked: int = Field(default=0, ge=0)
    location: str | None = Field(default=None, max_length=180)
    description: str | None = Field(default=None, max_length=500)
    status: str = Field(default="scheduled", min_length=1, max_length=32)


class FitnessClassUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=180)
    instructor_name: str | None = Field(default=None, max_length=180)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    capacity: int | None = Field(default=None, ge=0)
    booked: int | None = Field(default=None, ge=0)
    location: str | None = Field(default=None, max_length=180)
    description: str | None = Field(default=None, max_length=500)
    status: str | None = Field(default=None, max_length=32)


class FitnessCheckinRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    property_id: uuid.UUID
    guest_id: uuid.UUID
    class_id: uuid.UUID | None = None
    checked_in_at: datetime
    source: str = Field(min_length=1, max_length=32)
    notes: str | None = Field(default=None, max_length=500)
    created_at: datetime
    updated_at: datetime


class FitnessCheckinList(BaseModel):
    items: list[FitnessCheckinRead]


class FitnessCheckinCreate(BaseModel):
    property_id: uuid.UUID
    guest_id: uuid.UUID
    class_id: uuid.UUID | None = None
    checked_in_at: datetime | None = None
    source: str = Field(default="manual", min_length=1, max_length=32)
    notes: str | None = Field(default=None, max_length=500)

