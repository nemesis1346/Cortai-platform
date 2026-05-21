import uuid
from datetime import datetime

from pydantic import BaseModel, Field


DeviceType = str  # edge_main | edge_distributed | sensor | gateway


class DeviceBase(BaseModel):
    device_id: str = Field(min_length=1, max_length=128)
    type: DeviceType
    capabilities: list[str] = Field(default_factory=list)
    property_id: uuid.UUID | None = None
    cert_fingerprint: str | None = Field(default=None, max_length=128)
    logical_bindings: dict = Field(default_factory=dict)


class DeviceCreate(DeviceBase):
    pass


class DeviceUpdate(BaseModel):
    type: DeviceType | None = None
    capabilities: list[str] | None = None
    property_id: uuid.UUID | None = None
    cert_fingerprint: str | None = Field(default=None, max_length=128)
    logical_bindings: dict | None = None


class DeviceRead(DeviceBase):
    id: uuid.UUID
    org_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class DeviceList(BaseModel):
    items: list[DeviceRead]
    total: int
    page: int
    page_size: int

