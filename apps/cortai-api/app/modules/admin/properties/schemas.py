import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models import PropertyStatus


class PropertyBase(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    marsha_property_id: str | None = Field(default=None, max_length=32)
    address: str | None = None
    room_count: int | None = Field(default=None, ge=0, le=100000)
    status: PropertyStatus = PropertyStatus.ACTIVE


class PropertyCreate(PropertyBase):
    pass


class PropertyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    marsha_property_id: str | None = Field(default=None, max_length=32)
    address: str | None = None
    room_count: int | None = Field(default=None, ge=0, le=100000)
    status: PropertyStatus | None = None


class PropertyRead(PropertyBase):
    id: uuid.UUID
    org_id: uuid.UUID
    slug: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PropertyList(BaseModel):
    items: list[PropertyRead]
    total: int
    page: int
    page_size: int

