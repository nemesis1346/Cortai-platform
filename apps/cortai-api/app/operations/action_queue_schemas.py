import enum
import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ActionQueueType(enum.StrEnum):
    REQUEST = "request"
    INCIDENT = "incident"
    SYSTEM_ALERT = "system_alert"
    VIP = "vip"
    TASK = "task"


class ActionQueueStatus(enum.StrEnum):
    PENDING = "pending"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    URGENT = "urgent"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class ActionQueueSeverity(enum.StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class ActionQueueItem(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    property_id: uuid.UUID

    type: ActionQueueType
    source: str | None = None
    room_id: uuid.UUID | None = None
    guest_id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=240)

    status: ActionQueueStatus
    severity: ActionQueueSeverity
    assigned_to_user_id: uuid.UUID | None = None
    sla_due_at: datetime | None = None
    completed_at: datetime | None = None
    parent_incident_id: uuid.UUID | None = None

    created_at: datetime
    updated_at: datetime


class ActionQueueList(BaseModel):
    items: list[ActionQueueItem]
    next_cursor: str | None = None


class ActionQueueCreate(BaseModel):
    property_id: uuid.UUID
    type: ActionQueueType
    source: str | None = None
    room_id: uuid.UUID | None = None
    guest_id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=240)

    status: ActionQueueStatus = ActionQueueStatus.PENDING
    severity: ActionQueueSeverity = ActionQueueSeverity.LOW

    assigned_to_user_id: uuid.UUID | None = None
    sla_due_at: datetime | None = None
    parent_incident_id: uuid.UUID | None = None
