"""ops guest message threads

Revision ID: 20260610_0022
Revises: 20260610_0021
Create Date: 2026-06-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260610_0022"
down_revision: str | None = "20260610_0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "guest_message_threads",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("thread_id", sa.String(length=128), nullable=False),
        sa.Column("guest_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "channel",
            postgresql.ENUM(name="ops_guest_message_channel", create_type=False),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=32), nullable=False, server_default=sa.text("'open'")),
        sa.Column("assigned_to_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("unread_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["guest_id"], ["ops.guests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assigned_to_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("org_id", "thread_id", name="uq_ops_guest_message_threads_org_thread"),
        schema="ops",
    )
    op.create_index(
        "ix_ops_gm_threads_org_property_last_msg",
        "guest_message_threads",
        ["org_id", "property_id", "last_message_at"],
        schema="ops",
    )
    op.create_index(
        "ix_ops_gm_threads_org_property_status",
        "guest_message_threads",
        ["org_id", "property_id", "status"],
        schema="ops",
    )
    op.create_index(
        "ix_ops_gm_threads_org_guest",
        "guest_message_threads",
        ["org_id", "guest_id"],
        schema="ops",
    )

    op.execute("alter table ops.guest_message_threads enable row level security")
    op.execute("alter table ops.guest_message_threads force row level security")
    op.execute(
        """
        create policy ops_guest_message_threads_org_isolation on ops.guest_message_threads
        using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        """
    )
    op.execute("drop trigger if exists trg_ops_guest_message_threads_set_updated_at on ops.guest_message_threads")
    op.execute(
        """
        create trigger trg_ops_guest_message_threads_set_updated_at
        before update on ops.guest_message_threads
        for each row execute function public.set_updated_at();
        """
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ops_gm_threads_org_guest",
        table_name="guest_message_threads",
        schema="ops",
    )
    op.drop_index(
        "ix_ops_gm_threads_org_property_status",
        table_name="guest_message_threads",
        schema="ops",
    )
    op.drop_index(
        "ix_ops_gm_threads_org_property_last_msg",
        table_name="guest_message_threads",
        schema="ops",
    )
    op.drop_table("guest_message_threads", schema="ops")

