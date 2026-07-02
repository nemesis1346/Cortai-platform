from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

FormSubmissionStatus = Literal["draft", "submitted", "reviewed", "archived"]

ADMIN_ROLES = {"IT_ADMIN", "SERVICE_PROVIDER_ADMIN"}
REVIEW_STATUSES: set[str] = {"reviewed", "archived"}


class FormSubmissionCreate(BaseModel):
    form_definition_id: uuid.UUID
    payload_json: dict[str, Any]
    source_property_id: uuid.UUID | None = None
    # draft=True means save without submitting
    save_as_draft: bool = False


class FormSubmissionStatusUpdate(BaseModel):
    status: FormSubmissionStatus


class FormSubmissionRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    form_definition_id: uuid.UUID
    form_version: int
    submitted_by_user_id: uuid.UUID | None
    submitted_by_guest_id: uuid.UUID | None
    payload_json: dict[str, Any]
    source_property_id: uuid.UUID | None
    status: FormSubmissionStatus
    created_at: datetime
    updated_at: datetime
    submitted_at: datetime | None
    # Joined from form_definitions for convenience
    form_slug: str | None = None
    form_title_en: str | None = None
    form_title_fr: str | None = None
    form_schema_json: dict[str, Any] | None = None


class FormSubmissionList(BaseModel):
    items: list[FormSubmissionRead]
    total: int
    page: int
    page_size: int