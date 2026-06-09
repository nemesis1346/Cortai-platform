import enum
import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class IncidentSeverity(enum.StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class IncidentStatus(enum.StrEnum):
    OPEN = "OPEN"
    IN_PROGRESS = "IN_PROGRESS"
    RESOLVED = "RESOLVED"


class IncidentBase(BaseModel):
    property_id: uuid.UUID
    severity: IncidentSeverity
    status: IncidentStatus = IncidentStatus.OPEN
    title: str = Field(min_length=1, max_length=180)
    description: str | None = None
    assigned_to: uuid.UUID | None = None


class IncidentCreate(IncidentBase):
    pass


class IncidentUpdate(BaseModel):
    property_id: uuid.UUID | None = None
    severity: IncidentSeverity | None = None
    status: IncidentStatus | None = None
    title: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = None
    assigned_to: uuid.UUID | None = None
    resolved_at: datetime | None = None


class IncidentAssignRequest(BaseModel):
    assigned_to: uuid.UUID | None = None


class IncidentAttachmentPresignRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=200)
    content_type: str = Field(min_length=1, max_length=200)


class IncidentAttachmentPresignResponse(BaseModel):
    key: str
    upload_url: str
    upload_headers: dict[str, str] = Field(default_factory=dict)


class IncidentEscalateRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)
    severity: IncidentSeverity | None = None


class IncidentTriageResponse(BaseModel):
    suggested_priority: str
    suggested_category: str
    suggested_assignee_id: uuid.UUID | None = None
    confidence: float | None = None
    reasoning_md: str


class IncidentRead(IncidentBase):
    id: uuid.UUID
    org_id: uuid.UUID
    created_at: datetime
    resolved_at: datetime | None = None
    sla_due_at: datetime | None = None
    sla_escalated_at: datetime | None = None


class IncidentList(BaseModel):
    items: list[IncidentRead]
    total: int
    page: int
    page_size: int

