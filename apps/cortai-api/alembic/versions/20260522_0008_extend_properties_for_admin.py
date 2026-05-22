"""extend properties for admin CRUD

Revision ID: 20260522_0008
Revises: 20260522_0007
Create Date: 2026-05-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260522_0008"
down_revision: str | None = "20260522_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


PROPERTY_STATUS_ENUM = postgresql.ENUM(
    "ACTIVE",
    "INACTIVE",
    name="property_status",
    create_type=False,
)


def upgrade() -> None:
    # Create ENUM idempotently (alembic create_table runs with checkfirst=False).
    op.execute(
        """
        do $$
        begin
          create type property_status as enum ('ACTIVE', 'INACTIVE');
        exception
          when duplicate_object then null;
        end $$;
        """
    )

    # Extend existing `properties` table (created in 20260519_0003).
    op.add_column(
        "properties",
        sa.Column("marsha_property_id", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "properties",
        sa.Column("address", sa.Text(), nullable=True),
    )
    op.add_column(
        "properties",
        sa.Column("room_count", sa.Integer(), nullable=True),
    )
    op.add_column(
        "properties",
        sa.Column(
            "status",
            PROPERTY_STATUS_ENUM,
            nullable=False,
            server_default=sa.text("'ACTIVE'"),
        ),
    )

    # Helpful indexes for list/filter endpoints.
    op.create_index("ix_properties_org_id", "properties", ["org_id"])
    op.create_index("ix_properties_org_status", "properties", ["org_id", "status"])

    # Optional MARSHA ID uniqueness within org (when present).
    op.create_index(
        "uq_properties_org_marsha_property_id",
        "properties",
        ["org_id", "marsha_property_id"],
        unique=True,
        postgresql_where=sa.text("marsha_property_id is not null"),
    )

    # Defaults to simplify inserts; also keep updated_at fresh on update.
    op.execute("alter table properties alter column created_at set default now()")
    op.execute("alter table properties alter column updated_at set default now()")
    op.execute(
        """
        create or replace function public.set_updated_at()
        returns trigger as $$
        begin
          new.updated_at = now();
          return new;
        end;
        $$ language plpgsql;
        """
    )
    op.execute("drop trigger if exists trg_properties_set_updated_at on properties")
    op.execute(
        """
        create trigger trg_properties_set_updated_at
        before update on properties
        for each row execute function public.set_updated_at();
        """
    )


def downgrade() -> None:
    op.execute("drop trigger if exists trg_properties_set_updated_at on properties")
    # Keep function around if other tables use it; safe to drop in our repo.
    op.execute("drop function if exists public.set_updated_at")

    op.execute("alter table properties alter column updated_at drop default")
    op.execute("alter table properties alter column created_at drop default")

    op.drop_index("uq_properties_org_marsha_property_id", table_name="properties")
    op.drop_index("ix_properties_org_status", table_name="properties")
    op.drop_index("ix_properties_org_id", table_name="properties")

    op.drop_column("properties", "status")
    op.drop_column("properties", "room_count")
    op.drop_column("properties", "address")
    op.drop_column("properties", "marsha_property_id")

    op.execute("drop type if exists property_status")

