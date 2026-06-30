"""realtime event_log enable row level security

Revision ID: 20260630_0025
Revises: 20260622_0024
Create Date: 2026-06-30
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260630_0025"
down_revision: str | None = "20260622_0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("alter table realtime.event_log enable row level security")
    op.execute("alter table realtime.event_log force row level security")
    op.execute(
        """
        create policy realtime_event_log_org_isolation on realtime.event_log
        using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        """
    )


def downgrade() -> None:
    op.execute("drop policy if exists realtime_event_log_org_isolation on realtime.event_log")
    op.execute("alter table realtime.event_log disable row level security")