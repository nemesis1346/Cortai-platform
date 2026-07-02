import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


FormStatus = Literal["draft", "published", "archived"]


class FormDefinitionCreate(BaseModel):
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9\-]*[a-z0-9]$")
    title_en: str = Field(min_length=1, max_length=180)
    title_fr: str = Field(min_length=1, max_length=180)
    schema_json: dict[str, Any] = Field(default_factory=dict)
    ui_hints_json: dict[str, Any] = Field(default_factory=dict)


class FormDefinitionUpdate(BaseModel):
    title_en: str | None = Field(default=None, min_length=1, max_length=180)
    title_fr: str | None = Field(default=None, min_length=1, max_length=180)
    schema_json: dict[str, Any] | None = None
    ui_hints_json: dict[str, Any] | None = None


class FormDefinitionRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    slug: str
    title_en: str
    title_fr: str
    schema_json: dict[str, Any]
    ui_hints_json: dict[str, Any]
    version: int
    status: FormStatus
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None

    model_config = {"from_attributes": True}


class FormDefinitionList(BaseModel):
    items: list[FormDefinitionRead]
    total: int
    page: int
    page_size: int