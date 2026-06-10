"""realtime event log

Revision ID: 20260610_0021
Revises: 20260610_0020
Create Date: 2026-06-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260610_0021"
down_revision: str | None = "20260610_0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("create schema if not exists realtime")
    op.create_table(
        "event_log",
        sa.Column("sequence", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("type", sa.String(length=120), nullable=False),
        sa.Column("payload_json", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        schema="realtime",
    )
    op.create_index("ix_realtime_event_log_org_property_sequence", "event_log", ["org_id", "property_id", "sequence"], schema="realtime")
    op.create_index("ix_realtime_event_log_org_sequence", "event_log", ["org_id", "sequence"], schema="realtime")


def downgrade() -> None:
    op.drop_index("ix_realtime_event_log_org_sequence", table_name="event_log", schema="realtime")
    op.drop_index("ix_realtime_event_log_org_property_sequence", table_name="event_log", schema="realtime")
    op.drop_table("event_log", schema="realtime")

