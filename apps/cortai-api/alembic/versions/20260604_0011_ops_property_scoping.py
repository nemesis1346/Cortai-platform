"""ops property scoping columns

Revision ID: 20260604_0011
Revises: 20260603_0010
Create Date: 2026-06-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260604_0011"
down_revision: str | None = "20260603_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add nullable columns first so upgrade can backfill.
    op.add_column("rooms", sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=True), schema="ops")
    op.add_column(
        "action_queue",
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="ops",
    )
    op.add_column(
        "front_desk_events",
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="ops",
    )
    op.add_column(
        "housekeeping_assignments",
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="ops",
    )

    # Best-effort backfill:
    # - rooms: first property in org
    # - housekeeping_assignments: join to rooms
    # - front_desk_events: reservation.property_id if present else first property in org
    # - action_queue: join to rooms if present else first property in org
    op.execute(
        """
        with first_prop as (
          select distinct on (org_id) org_id, id as property_id
          from properties
          order by org_id, created_at asc, id asc
        )
        update ops.rooms r
        set property_id = fp.property_id
        from first_prop fp
        where r.org_id = fp.org_id
          and r.property_id is null
        """
    )

    op.execute(
        """
        update ops.housekeeping_assignments a
        set property_id = r.property_id
        from ops.rooms r
        where a.room_id = r.id
          and a.property_id is null
        """
    )

    op.execute(
        """
        update ops.front_desk_events e
        set property_id = r.property_id
        from ops.reservations r
        where e.reservation_id = r.id
          and e.property_id is null
        """
    )
    op.execute(
        """
        with first_prop as (
          select distinct on (org_id) org_id, id as property_id
          from properties
          order by org_id, created_at asc, id asc
        )
        update ops.front_desk_events e
        set property_id = fp.property_id
        from first_prop fp
        where e.org_id = fp.org_id
          and e.property_id is null
        """
    )

    op.execute(
        """
        update ops.action_queue q
        set property_id = r.property_id
        from ops.rooms r
        where q.room_id = r.id
          and q.property_id is null
        """
    )
    op.execute(
        """
        with first_prop as (
          select distinct on (org_id) org_id, id as property_id
          from properties
          order by org_id, created_at asc, id asc
        )
        update ops.action_queue q
        set property_id = fp.property_id
        from first_prop fp
        where q.org_id = fp.org_id
          and q.property_id is null
        """
    )

    # Add FKs + indexes + make non-nullable.
    op.create_foreign_key(
        "fk_ops_rooms_property_id",
        "rooms",
        "properties",
        ["property_id"],
        ["id"],
        source_schema="ops",
        referent_schema=None,
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_ops_action_queue_property_id",
        "action_queue",
        "properties",
        ["property_id"],
        ["id"],
        source_schema="ops",
        referent_schema=None,
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_ops_front_desk_events_property_id",
        "front_desk_events",
        "properties",
        ["property_id"],
        ["id"],
        source_schema="ops",
        referent_schema=None,
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_ops_housekeeping_assignments_property_id",
        "housekeeping_assignments",
        "properties",
        ["property_id"],
        ["id"],
        source_schema="ops",
        referent_schema=None,
        ondelete="CASCADE",
    )

    op.create_index("ix_ops_rooms_org_property_status", "rooms", ["org_id", "property_id", "status"], schema="ops")
    op.create_index(
        "ix_ops_action_queue_org_property_status",
        "action_queue",
        ["org_id", "property_id", "status"],
        schema="ops",
    )
    op.create_index(
        "ix_ops_front_desk_events_org_property_started_at",
        "front_desk_events",
        ["org_id", "property_id", "started_at"],
        schema="ops",
    )
    op.create_index(
        "ix_ops_housekeeping_assignments_org_property_status",
        "housekeeping_assignments",
        ["org_id", "property_id", "status"],
        schema="ops",
    )

    op.alter_column("rooms", "property_id", nullable=False, schema="ops")
    op.alter_column("action_queue", "property_id", nullable=False, schema="ops")
    op.alter_column("front_desk_events", "property_id", nullable=False, schema="ops")
    op.alter_column("housekeeping_assignments", "property_id", nullable=False, schema="ops")


def downgrade() -> None:
    op.alter_column("housekeeping_assignments", "property_id", nullable=True, schema="ops")
    op.alter_column("front_desk_events", "property_id", nullable=True, schema="ops")
    op.alter_column("action_queue", "property_id", nullable=True, schema="ops")
    op.alter_column("rooms", "property_id", nullable=True, schema="ops")

    op.drop_index("ix_ops_housekeeping_assignments_org_property_status", table_name="housekeeping_assignments", schema="ops")
    op.drop_index("ix_ops_front_desk_events_org_property_started_at", table_name="front_desk_events", schema="ops")
    op.drop_index("ix_ops_action_queue_org_property_status", table_name="action_queue", schema="ops")
    op.drop_index("ix_ops_rooms_org_property_status", table_name="rooms", schema="ops")

    op.drop_constraint("fk_ops_housekeeping_assignments_property_id", "housekeeping_assignments", schema="ops", type_="foreignkey")
    op.drop_constraint("fk_ops_front_desk_events_property_id", "front_desk_events", schema="ops", type_="foreignkey")
    op.drop_constraint("fk_ops_action_queue_property_id", "action_queue", schema="ops", type_="foreignkey")
    op.drop_constraint("fk_ops_rooms_property_id", "rooms", schema="ops", type_="foreignkey")

    op.drop_column("housekeeping_assignments", "property_id", schema="ops")
    op.drop_column("front_desk_events", "property_id", schema="ops")
    op.drop_column("action_queue", "property_id", schema="ops")
    op.drop_column("rooms", "property_id", schema="ops")

