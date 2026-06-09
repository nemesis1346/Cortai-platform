"""ops incident sla config

Revision ID: 53d8f212dbb5
Revises: 20260609_0014
Create Date: 2026-06-09 14:34:02.906129
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "53d8f212dbb5"
down_revision: str | None = "20260609_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # For gen_random_uuid() used in seeds / future inserts.
    op.execute("create extension if not exists pgcrypto")
    op.execute("create schema if not exists ops")

    op.create_table(
        "incident_sla_config",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("due_after_minutes", sa.Integer(), nullable=False),
        sa.Column("auto_escalate", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("org_id", "severity", name="uq_ops_incident_sla_config_org_severity"),
        schema="ops",
    )
    op.create_index(
        "ix_ops_incident_sla_config_org_severity",
        "incident_sla_config",
        ["org_id", "severity"],
        schema="ops",
    )
    op.execute("alter table ops.incident_sla_config enable row level security")
    op.execute("alter table ops.incident_sla_config force row level security")
    op.execute(
        """
        create policy ops_incident_sla_config_org_isolation on ops.incident_sla_config
        using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        """
    )
    op.execute("drop trigger if exists trg_ops_incident_sla_config_set_updated_at on ops.incident_sla_config")
    op.execute(
        """
        create trigger trg_ops_incident_sla_config_set_updated_at
        before update on ops.incident_sla_config
        for each row execute function public.set_updated_at();
        """
    )

    op.add_column(
        "incidents",
        sa.Column("sla_due_at", sa.DateTime(timezone=True), nullable=True),
        schema="operations",
    )
    op.add_column(
        "incidents",
        sa.Column("sla_escalated_at", sa.DateTime(timezone=True), nullable=True),
        schema="operations",
    )
    op.create_index(
        "ix_operations_incidents_org_sla_due_at",
        "incidents",
        ["org_id", "sla_due_at"],
        schema="operations",
    )

    # Seed defaults per org (safe to re-run).
    op.execute(
        """
        insert into ops.incident_sla_config (id, org_id, severity, due_after_minutes, auto_escalate)
        select
          gen_random_uuid(),
          o.id,
          v.severity,
          v.due_after_minutes,
          true
        from organizations o
        cross join (
          values
            ('LOW', 240),
            ('MEDIUM', 120),
            ('HIGH', 60),
            ('CRITICAL', 30)
        ) as v(severity, due_after_minutes)
        on conflict (org_id, severity) do nothing
        """
    )


def downgrade() -> None:
    op.drop_index(
        "ix_operations_incidents_org_sla_due_at",
        table_name="incidents",
        schema="operations",
    )
    op.drop_column("incidents", "sla_escalated_at", schema="operations")
    op.drop_column("incidents", "sla_due_at", schema="operations")

    op.execute("drop trigger if exists trg_ops_incident_sla_config_set_updated_at on ops.incident_sla_config")
    op.execute("drop policy if exists ops_incident_sla_config_org_isolation on ops.incident_sla_config")
    op.drop_index(
        "ix_ops_incident_sla_config_org_severity",
        table_name="incident_sla_config",
        schema="ops",
    )
    op.drop_table("incident_sla_config", schema="ops")
