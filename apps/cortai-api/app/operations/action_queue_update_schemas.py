import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.operations.action_queue_schemas import ActionQueueSeverity, ActionQueueStatus, ActionQueueType


class ActionQueueUpdate(BaseModel):
    type: ActionQueueType | None = None
    source: str | None = None
    room_id: uuid.UUID | None = None
    guest_id: uuid.UUID | None = None
    title: str | None = Field(default=None, min_length=1, max_length=240)

    status: ActionQueueStatus | None = None
    severity: ActionQueueSeverity | None = None

    assigned_to_user_id: uuid.UUID | None = None
    sla_due_at: datetime | None = None
    completed_at: datetime | None = None
    parent_incident_id: uuid.UUID | None = None
