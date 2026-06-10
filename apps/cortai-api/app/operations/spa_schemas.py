from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class SpaAppointmentRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    property_id: uuid.UUID
    guest_id: uuid.UUID
    service: str = Field(min_length=1, max_length=120)
    therapist_user_id: uuid.UUID | None = None
    starts_at: datetime
    ends_at: datetime
    status: str | None = Field(default=None, max_length=32)
    created_at: datetime
    updated_at: datetime


class SpaAppointmentList(BaseModel):
    items: list[SpaAppointmentRead]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)


class SpaAppointmentCreate(BaseModel):
    property_id: uuid.UUID
    guest_id: uuid.UUID
    service: str = Field(min_length=1, max_length=120)
    therapist_user_id: uuid.UUID | None = None
    starts_at: datetime
    ends_at: datetime
    status: str | None = Field(default=None, max_length=32)


class SpaAppointmentUpdate(BaseModel):
    guest_id: uuid.UUID | None = None
    service: str | None = Field(default=None, max_length=120)
    therapist_user_id: uuid.UUID | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    status: str | None = Field(default=None, max_length=32)


class SpaServiceRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    property_id: uuid.UUID
    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=500)
    duration_minutes: int = Field(ge=0)
    price_cents: int = Field(ge=0)
    available: bool
    created_at: datetime
    updated_at: datetime


class SpaServiceList(BaseModel):
    items: list[SpaServiceRead]


class SpaServiceCreate(BaseModel):
    property_id: uuid.UUID
    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=500)
    duration_minutes: int = Field(ge=0)
    price_cents: int = Field(ge=0)
    available: bool = True

