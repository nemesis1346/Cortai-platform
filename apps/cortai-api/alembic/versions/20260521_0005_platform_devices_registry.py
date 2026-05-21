"""platform.devices vendor-agnostic registry

Revision ID: 20260521_0005
Revises: 20260520_0004
Create Date: 2026-05-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260521_0005"
down_revision: str | None = "20260520_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


DEVICE_TYPE_ENUM = postgresql.ENUM(
    "edge_main",
    "edge_distributed",
    "sensor",
    "gateway",
    name="device_type",
    create_type=False,
)


def upgrade() -> None:
    op.execute("create schema if not exists platform")
    # Alembic runs table DDL with checkfirst=False; if we attach an ENUM type to the
    # table, SQLAlchemy will try to CREATE TYPE during create_table unless we set
    # create_type=False. Create the type explicitly, idempotently.
    op.execute(
        """
        do $$
        begin
          create type device_type as enum ('edge_main', 'edge_distributed', 'sensor', 'gateway');
        exception
          when duplicate_object then null;
        end $$;
        """
    )

    op.create_table(
        "devices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("device_id", sa.String(length=128), nullable=False),
        sa.Column("type", DEVICE_TYPE_ENUM, nullable=False),
        sa.Column("capabilities", postgresql.ARRAY(sa.String(length=128)), nullable=False),
        sa.Column("cert_fingerprint", sa.String(length=128), nullable=True),
        sa.Column("logical_bindings", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("org_id", "device_id", name="uq_platform_devices_org_device_id"),
        sa.UniqueConstraint("org_id", "cert_fingerprint", name="uq_platform_devices_org_cert_fingerprint"),
        schema="platform",
    )

    op.create_index(
        "ix_platform_devices_org_property_type",
        "devices",
        ["org_id", "property_id", "type"],
        schema="platform",
    )
    op.create_index(
        "ix_platform_devices_org_device_id",
        "devices",
        ["org_id", "device_id"],
        schema="platform",
    )

    op.execute("alter table platform.devices enable row level security")
    op.execute("alter table platform.devices force row level security")
    op.execute(
        """
        create policy platform_devices_org_isolation on platform.devices
        using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        """
    )

    # Keep updated_at fresh without requiring ORM triggers.
    op.execute(
        """
        create or replace function platform.set_updated_at()
        returns trigger as $$
        begin
          new.updated_at = now();
          return new;
        end;
        $$ language plpgsql;
        """
    )
    op.execute(
        """
        create trigger trg_platform_devices_set_updated_at
        before update on platform.devices
        for each row execute function platform.set_updated_at();
        """
    )


def downgrade() -> None:
    op.execute("drop trigger if exists trg_platform_devices_set_updated_at on platform.devices")
    op.execute("drop function if exists platform.set_updated_at")

    op.execute("drop policy if exists platform_devices_org_isolation on platform.devices")
    op.drop_index("ix_platform_devices_org_device_id", table_name="devices", schema="platform")
    op.drop_index("ix_platform_devices_org_property_type", table_name="devices", schema="platform")
    op.drop_table("devices", schema="platform")

    op.execute("drop type if exists device_type")
    op.execute("drop schema if exists platform")

