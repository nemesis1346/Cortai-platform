"""ops meeting rooms property scoping

Revision ID: 20260610_0019
Revises: 20260610_0018
Create Date: 2026-06-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260610_0019"
down_revision: str | None = "20260610_0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "meeting_rooms",
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="ops",
    )
    # Backfill to first property in org.
    op.execute(
        """
        with first_prop as (
          select distinct on (org_id) org_id, id as property_id
          from properties
          order by org_id, created_at asc, id asc
        )
        update ops.meeting_rooms mr
        set property_id = fp.property_id
        from first_prop fp
        where mr.org_id = fp.org_id
          and mr.property_id is null
        """
    )

    op.create_foreign_key(
        "fk_ops_meeting_rooms_property_id",
        "meeting_rooms",
        "properties",
        ["property_id"],
        ["id"],
        source_schema="ops",
        referent_schema=None,
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_ops_meeting_rooms_org_property_name",
        "meeting_rooms",
        ["org_id", "property_id", "name"],
        schema="ops",
    )
    op.alter_column("meeting_rooms", "property_id", nullable=False, schema="ops")


def downgrade() -> None:
    op.alter_column("meeting_rooms", "property_id", nullable=True, schema="ops")
    op.drop_index("ix_ops_meeting_rooms_org_property_name", table_name="meeting_rooms", schema="ops")
    op.drop_constraint("fk_ops_meeting_rooms_property_id", "meeting_rooms", schema="ops", type_="foreignkey")
    op.drop_column("meeting_rooms", "property_id", schema="ops")

