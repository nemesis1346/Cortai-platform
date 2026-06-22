"""ops room cleaning logs

Revision ID: 20260622_0024
Revises: 20260610_0023
Create Date: 2026-06-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260622_0024"
down_revision: str | None = "20260610_0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "room_cleaning_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("room_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("staff_name", sa.Text(), nullable=False),
        sa.Column("clean_type", sa.Text(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("score_pct", sa.SmallInteger(), nullable=True),
        sa.Column("cleaned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["room_id"], ["ops.rooms.id"], ondelete="CASCADE"),
        schema="ops",
    )
    op.create_index("ix_ops_room_cleaning_logs_room", "room_cleaning_logs", ["org_id", "room_id", "cleaned_at"], schema="ops")

    op.execute("alter table ops.room_cleaning_logs enable row level security")
    op.execute("alter table ops.room_cleaning_logs force row level security")
    op.execute(
        """
        create policy ops_room_cleaning_logs_org_isolation on ops.room_cleaning_logs
        using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        """
    )


def downgrade() -> None:
    op.execute("drop policy if exists ops_room_cleaning_logs_org_isolation on ops.room_cleaning_logs")
    op.drop_table("room_cleaning_logs", schema="ops")
