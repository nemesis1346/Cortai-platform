import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class DevicePublicRead(BaseModel):
    id: uuid.UUID
    property_id: uuid.UUID | None = None
    device_id: str = Field(min_length=1, max_length=128)
    type: str
    capabilities: list[str] = Field(default_factory=list)
    logical_bindings: dict = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

