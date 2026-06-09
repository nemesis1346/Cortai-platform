"""ops guest services requests

Revision ID: 20260609_0013
Revises: 20260609_0012
Create Date: 2026-06-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260609_0013"
down_revision: str | None = "20260609_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            """
            do $$
            begin
              if not exists (select 1 from pg_type where typname = 'ops_guest_service_type') then
                create type ops_guest_service_type as enum (
                  'towels','pillows','amenities','late_checkout','wake_up','other'
                );
              end if;
              if not exists (select 1 from pg_type where typname = 'ops_guest_service_status') then
                create type ops_guest_service_status as enum ('pending','assigned','completed','cancelled');
              end if;
            end $$;
            """
        )

    op.create_table(
        "guest_service_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("room_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("guest_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("type", postgresql.ENUM(name="ops_guest_service_type", create_type=False), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(name="ops_guest_service_status", create_type=False),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("assigned_to_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["room_id"], ["ops.rooms.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["guest_id"], ["ops.guests.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["assigned_to_user_id"], ["users.id"], ondelete="SET NULL"),
        schema="ops",
    )
    op.create_index(
        "ix_ops_guest_service_org_property_status",
        "guest_service_requests",
        ["org_id", "property_id", "status"],
        schema="ops",
    )
    op.create_index(
        "ix_ops_guest_service_org_property_room",
        "guest_service_requests",
        ["org_id", "property_id", "room_id"],
        schema="ops",
    )
    op.create_index(
        "ix_ops_guest_service_org_property_type",
        "guest_service_requests",
        ["org_id", "property_id", "type"],
        schema="ops",
    )

    op.execute("alter table ops.guest_service_requests enable row level security")
    op.execute("alter table ops.guest_service_requests force row level security")
    op.execute(
        """
        create policy ops_guest_service_org_isolation on ops.guest_service_requests
        using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        """
    )
    op.execute("drop trigger if exists trg_ops_guest_service_set_updated_at on ops.guest_service_requests")
    op.execute(
        """
        create trigger trg_ops_guest_service_set_updated_at
        before update on ops.guest_service_requests
        for each row execute function public.set_updated_at();
        """
    )


def downgrade() -> None:
    op.drop_index("ix_ops_guest_service_org_property_type", table_name="guest_service_requests", schema="ops")
    op.drop_index("ix_ops_guest_service_org_property_room", table_name="guest_service_requests", schema="ops")
    op.drop_index("ix_ops_guest_service_org_property_status", table_name="guest_service_requests", schema="ops")
    op.drop_table("guest_service_requests", schema="ops")
    # NOTE: enums are left in place intentionally.

