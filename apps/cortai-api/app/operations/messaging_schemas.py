from __future__ import annotations

import enum
import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class GuestMessageChannel(enum.StrEnum):
    SMS = "sms"
    WHATSAPP = "whatsapp"
    EMAIL = "email"
    IN_APP = "in_app"


class GuestMessageThreadRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    property_id: uuid.UUID

    thread_id: str = Field(min_length=1, max_length=128)
    guest_id: uuid.UUID
    guest_first_name: str | None = None
    guest_last_name: str | None = None

    channel: GuestMessageChannel
    status: str = Field(min_length=1, max_length=32)
    assigned_to_user_id: uuid.UUID | None = None
    unread_count: int = Field(ge=0)
    last_message_at: datetime | None = None

    created_at: datetime
    updated_at: datetime


class GuestMessageThreadList(BaseModel):
    items: list[GuestMessageThreadRead]


class GuestMessageDirection(enum.StrEnum):
    INBOUND = "in"
    OUTBOUND = "out"


class GuestMessageRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID

    thread_id: str = Field(min_length=1, max_length=128)
    channel: GuestMessageChannel
    direction: GuestMessageDirection
    guest_id: uuid.UUID
    body: str
    status: str | None = Field(default=None, max_length=32)
    sent_at: datetime

    created_at: datetime
    updated_at: datetime


class GuestMessageList(BaseModel):
    items: list[GuestMessageRead]

