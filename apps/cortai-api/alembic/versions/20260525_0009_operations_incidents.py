"""operations incidents table

Revision ID: 20260525_0009
Revises: 20260522_0008
Create Date: 2026-05-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260525_0009"
down_revision: str | None = "20260522_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


INCIDENT_SEVERITY_ENUM = postgresql.ENUM(
    "LOW",
    "MEDIUM",
    "HIGH",
    "CRITICAL",
    name="incident_severity",
    create_type=False,
)

INCIDENT_STATUS_ENUM = postgresql.ENUM(
    "OPEN",
    "IN_PROGRESS",
    "RESOLVED",
    name="incident_status",
    create_type=False,
)


def upgrade() -> None:
    op.execute("create schema if not exists operations")

    op.execute(
        """
        do $$
        begin
          create type incident_severity as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
        exception
          when duplicate_object then null;
        end $$;
        """
    )
    op.execute(
        """
        do $$
        begin
          create type incident_status as enum ('OPEN', 'IN_PROGRESS', 'RESOLVED');
        exception
          when duplicate_object then null;
        end $$;
        """
    )

    op.create_table(
        "incidents",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("severity", INCIDENT_SEVERITY_ENUM, nullable=False),
        sa.Column(
            "status",
            INCIDENT_STATUS_ENUM,
            nullable=False,
            server_default=sa.text("'OPEN'"),
        ),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("assigned_to", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assigned_to"], ["users.id"], ondelete="SET NULL"),
        schema="operations",
    )

    op.create_index(
        "ix_operations_incidents_org_created_at",
        "incidents",
        ["org_id", "created_at"],
        schema="operations",
    )
    op.create_index(
        "ix_operations_incidents_org_property_created_at",
        "incidents",
        ["org_id", "property_id", "created_at"],
        schema="operations",
    )
    op.create_index(
        "ix_operations_incidents_org_severity_created_at",
        "incidents",
        ["org_id", "severity", "created_at"],
        schema="operations",
    )
    op.create_index(
        "ix_operations_incidents_org_status_created_at",
        "incidents",
        ["org_id", "status", "created_at"],
        schema="operations",
    )

    op.execute("alter table operations.incidents enable row level security")
    op.execute("alter table operations.incidents force row level security")
    op.execute(
        """
        create policy operations_incidents_org_isolation on operations.incidents
        using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        """
    )


def downgrade() -> None:
    op.execute(
        "drop policy if exists operations_incidents_org_isolation on operations.incidents"
    )
    op.drop_index(
        "ix_operations_incidents_org_status_created_at",
        table_name="incidents",
        schema="operations",
    )
    op.drop_index(
        "ix_operations_incidents_org_severity_created_at",
        table_name="incidents",
        schema="operations",
    )
    op.drop_index(
        "ix_operations_incidents_org_property_created_at",
        table_name="incidents",
        schema="operations",
    )
    op.drop_index(
        "ix_operations_incidents_org_created_at", table_name="incidents", schema="operations"
    )
    op.drop_table("incidents", schema="operations")

    op.execute("drop type if exists incident_status")
    op.execute("drop type if exists incident_severity")
    op.execute("drop schema if exists operations")

