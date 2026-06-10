from __future__ import annotations

import enum
import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class FbMenuService(enum.StrEnum):
    BREAKFAST = "breakfast"
    RESTAURANT = "restaurant"
    ROOM_SERVICE = "room_service"


class FbMenuItemRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID

    service: FbMenuService
    name_en: str = Field(min_length=1, max_length=180)
    name_fr: str | None = Field(default=None, max_length=180)
    price_cents: int = Field(ge=0)
    allergens: list[str] = Field(default_factory=list)
    available: bool = True

    created_at: datetime
    updated_at: datetime


class FbMenuList(BaseModel):
    items: list[FbMenuItemRead]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)


class FbMenuItemCreate(BaseModel):
    service: FbMenuService
    name_en: str = Field(min_length=1, max_length=180)
    name_fr: str | None = Field(default=None, max_length=180)
    price_cents: int = Field(ge=0)
    allergens: list[str] = Field(default_factory=list)
    available: bool = True


class FbMenuItemUpdate(BaseModel):
    service: FbMenuService | None = None
    name_en: str | None = Field(default=None, max_length=180)
    name_fr: str | None = Field(default=None, max_length=180)
    price_cents: int | None = Field(default=None, ge=0)
    allergens: list[str] | None = None
    available: bool | None = None


class RoomServiceOrderStatus(enum.StrEnum):
    RECEIVED = "received"
    PREPARING = "preparing"
    EN_ROUTE = "en_route"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"


class RoomServiceOrderRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    room_id: uuid.UUID
    guest_id: uuid.UUID | None = None
    items_json: dict | list
    status: RoomServiceOrderStatus
    created_at: datetime
    updated_at: datetime


class RoomServiceOrderList(BaseModel):
    items: list[RoomServiceOrderRead]


class RoomServiceOrderCreate(BaseModel):
    property_id: uuid.UUID
    room_id: uuid.UUID
    guest_id: uuid.UUID | None = None
    items_json: dict | list = Field(default_factory=dict)
    status: RoomServiceOrderStatus | None = None


class RoomServiceOrderUpdate(BaseModel):
    room_id: uuid.UUID | None = None
    guest_id: uuid.UUID | None = None
    items_json: dict | list | None = None
    status: RoomServiceOrderStatus | None = None

