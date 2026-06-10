"""ops spa services

Revision ID: 20260610_0016
Revises: 20260610_0015
Create Date: 2026-06-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260610_0016"
down_revision: str | None = "20260610_0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "spa_services",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("price_cents", sa.Integer(), nullable=False),
        sa.Column("available", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("org_id", "property_id", "name", name="uq_ops_spa_services_org_property_name"),
        schema="ops",
    )
    op.create_index(
        "ix_ops_spa_services_org_property_available",
        "spa_services",
        ["org_id", "property_id", "available"],
        schema="ops",
    )

    op.execute("alter table ops.spa_services enable row level security")
    op.execute("alter table ops.spa_services force row level security")
    op.execute(
        """
        create policy ops_spa_services_org_isolation on ops.spa_services
        using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        """
    )
    op.execute("drop trigger if exists trg_ops_spa_services_set_updated_at on ops.spa_services")
    op.execute(
        """
        create trigger trg_ops_spa_services_set_updated_at
        before update on ops.spa_services
        for each row execute function public.set_updated_at();
        """
    )


def downgrade() -> None:
    op.execute("drop trigger if exists trg_ops_spa_services_set_updated_at on ops.spa_services")
    op.execute("drop policy if exists ops_spa_services_org_isolation on ops.spa_services")
    op.drop_index("ix_ops_spa_services_org_property_available", table_name="spa_services", schema="ops")
    op.drop_table("spa_services", schema="ops")

