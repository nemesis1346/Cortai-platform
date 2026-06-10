"""ops spa appointments property scoping

Revision ID: 20260610_0015
Revises: 53d8f212dbb5
Create Date: 2026-06-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260610_0015"
down_revision: str | None = "53d8f212dbb5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add nullable column first for backfill.
    op.add_column(
        "spa_appointments",
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="ops",
    )

    # Best-effort backfill: infer property via guest's latest reservation, else first property in org.
    op.execute(
        """
        with latest_res as (
          select distinct on (r.org_id, r.guest_id)
            r.org_id,
            r.guest_id,
            r.property_id
          from ops.reservations r
          where r.property_id is not null
          order by r.org_id, r.guest_id, r.check_in_at desc, r.id desc
        )
        update ops.spa_appointments a
        set property_id = lr.property_id
        from latest_res lr
        where a.org_id = lr.org_id
          and a.guest_id = lr.guest_id
          and a.property_id is null
        """
    )
    op.execute(
        """
        with first_prop as (
          select distinct on (org_id) org_id, id as property_id
          from properties
          order by org_id, created_at asc, id asc
        )
        update ops.spa_appointments a
        set property_id = fp.property_id
        from first_prop fp
        where a.org_id = fp.org_id
          and a.property_id is null
        """
    )

    op.create_foreign_key(
        "fk_ops_spa_appointments_property_id",
        "spa_appointments",
        "properties",
        ["property_id"],
        ["id"],
        source_schema="ops",
        referent_schema=None,
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_ops_spa_appointments_org_property_starts_at",
        "spa_appointments",
        ["org_id", "property_id", "starts_at"],
        schema="ops",
    )
    op.alter_column("spa_appointments", "property_id", nullable=False, schema="ops")


def downgrade() -> None:
    op.alter_column("spa_appointments", "property_id", nullable=True, schema="ops")
    op.drop_index(
        "ix_ops_spa_appointments_org_property_starts_at",
        table_name="spa_appointments",
        schema="ops",
    )
    op.drop_constraint(
        "fk_ops_spa_appointments_property_id",
        "spa_appointments",
        schema="ops",
        type_="foreignkey",
    )
    op.drop_column("spa_appointments", "property_id", schema="ops")

