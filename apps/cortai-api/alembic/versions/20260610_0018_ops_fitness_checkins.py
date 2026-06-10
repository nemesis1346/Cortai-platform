"""ops fitness checkins

Revision ID: 20260610_0018
Revises: 20260610_0017
Create Date: 2026-06-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260610_0018"
down_revision: str | None = "20260610_0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "fitness_checkins",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("guest_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("class_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("source", sa.String(length=32), nullable=False, server_default=sa.text("'manual'")),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["guest_id"], ["ops.guests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["class_id"], ["ops.fitness_classes.id"], ondelete="SET NULL"),
        schema="ops",
    )
    op.create_index(
        "ix_ops_fitness_checkins_org_property_checked_in_at",
        "fitness_checkins",
        ["org_id", "property_id", "checked_in_at"],
        schema="ops",
    )
    op.create_index(
        "ix_ops_fitness_checkins_org_guest_checked_in_at",
        "fitness_checkins",
        ["org_id", "guest_id", "checked_in_at"],
        schema="ops",
    )

    op.execute("alter table ops.fitness_checkins enable row level security")
    op.execute("alter table ops.fitness_checkins force row level security")
    op.execute(
        """
        create policy ops_fitness_checkins_org_isolation on ops.fitness_checkins
        using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        """
    )
    op.execute("drop trigger if exists trg_ops_fitness_checkins_set_updated_at on ops.fitness_checkins")
    op.execute(
        """
        create trigger trg_ops_fitness_checkins_set_updated_at
        before update on ops.fitness_checkins
        for each row execute function public.set_updated_at();
        """
    )


def downgrade() -> None:
    op.execute("drop trigger if exists trg_ops_fitness_checkins_set_updated_at on ops.fitness_checkins")
    op.execute("drop policy if exists ops_fitness_checkins_org_isolation on ops.fitness_checkins")
    op.drop_index(
        "ix_ops_fitness_checkins_org_guest_checked_in_at",
        table_name="fitness_checkins",
        schema="ops",
    )
    op.drop_index(
        "ix_ops_fitness_checkins_org_property_checked_in_at",
        table_name="fitness_checkins",
        schema="ops",
    )
    op.drop_table("fitness_checkins", schema="ops")

