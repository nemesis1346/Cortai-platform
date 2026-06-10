"""ops meeting bookings property scoping

Revision ID: 20260610_0020
Revises: 20260610_0019
Create Date: 2026-06-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260610_0020"
down_revision: str | None = "20260610_0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "meeting_bookings",
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="ops",
    )

    # Backfill from meeting room if possible.
    op.execute(
        """
        update ops.meeting_bookings b
        set property_id = r.property_id
        from ops.meeting_rooms r
        where b.meeting_room_id = r.id
          and b.org_id = r.org_id
          and b.property_id is null
        """
    )
    # Fallback: first property in org.
    op.execute(
        """
        with first_prop as (
          select distinct on (org_id) org_id, id as property_id
          from properties
          order by org_id, created_at asc, id asc
        )
        update ops.meeting_bookings b
        set property_id = fp.property_id
        from first_prop fp
        where b.org_id = fp.org_id
          and b.property_id is null
        """
    )

    op.create_foreign_key(
        "fk_ops_meeting_bookings_property_id",
        "meeting_bookings",
        "properties",
        ["property_id"],
        ["id"],
        source_schema="ops",
        referent_schema=None,
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_ops_meeting_bookings_org_property_starts_at",
        "meeting_bookings",
        ["org_id", "property_id", "starts_at"],
        schema="ops",
    )
    op.alter_column("meeting_bookings", "property_id", nullable=False, schema="ops")


def downgrade() -> None:
    op.alter_column("meeting_bookings", "property_id", nullable=True, schema="ops")
    op.drop_index(
        "ix_ops_meeting_bookings_org_property_starts_at",
        table_name="meeting_bookings",
        schema="ops",
    )
    op.drop_constraint(
        "fk_ops_meeting_bookings_property_id",
        "meeting_bookings",
        schema="ops",
        type_="foreignkey",
    )
    op.drop_column("meeting_bookings", "property_id", schema="ops")

