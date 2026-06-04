"""ops schema core tables (tenant RLS)

Revision ID: 20260603_0010
Revises: 20260525_0009
Create Date: 2026-06-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260603_0010"
down_revision: str | None = "20260525_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


ROOM_STATUS_ENUM = postgresql.ENUM(
    "vacant_clean",
    "vacant_dirty",
    "occupied",
    "inspected",
    "out_of_order",
    name="ops_room_status",
    create_type=False,
)

GUEST_LANGUAGE_ENUM = postgresql.ENUM(
    "en",
    "fr",
    name="ops_guest_language",
    create_type=False,
)

RESERVATION_STATUS_ENUM = postgresql.ENUM(
    "booked",
    "checked_in",
    "checked_out",
    "cancelled",
    "no_show",
    name="ops_reservation_status",
    create_type=False,
)

ACTION_QUEUE_TYPE_ENUM = postgresql.ENUM(
    "request",
    "incident",
    "system_alert",
    "vip",
    "task",
    name="ops_action_queue_type",
    create_type=False,
)

ACTION_QUEUE_STATUS_ENUM = postgresql.ENUM(
    "pending",
    "assigned",
    "in_progress",
    "urgent",
    "completed",
    "cancelled",
    name="ops_action_queue_status",
    create_type=False,
)

ACTION_QUEUE_SEVERITY_ENUM = postgresql.ENUM(
    "low",
    "medium",
    "high",
    "urgent",
    name="ops_action_queue_severity",
    create_type=False,
)

FRONT_DESK_EVENT_KIND_ENUM = postgresql.ENUM(
    "queue_joined",
    "served",
    "checked_in",
    "walk_in",
    name="ops_front_desk_event_kind",
    create_type=False,
)

SHIFT_LABEL_ENUM = postgresql.ENUM(
    "morning",
    "afternoon",
    "night",
    name="ops_shift_label",
    create_type=False,
)

HOUSEKEEPING_ASSIGNMENT_STATUS_ENUM = postgresql.ENUM(
    "queued",
    "in_progress",
    "done",
    "inspected",
    "break",
    "dnd",
    name="ops_housekeeping_assignment_status",
    create_type=False,
)

MENU_SERVICE_ENUM = postgresql.ENUM(
    "breakfast",
    "restaurant",
    "room_service",
    name="ops_menu_service",
    create_type=False,
)

ROOM_SERVICE_ORDER_STATUS_ENUM = postgresql.ENUM(
    "received",
    "preparing",
    "en_route",
    "delivered",
    "cancelled",
    name="ops_room_service_order_status",
    create_type=False,
)

MEETING_SETUP_STATUS_ENUM = postgresql.ENUM(
    "setup",
    "ready",
    "in_use",
    "breakdown",
    "done",
    name="ops_meeting_setup_status",
    create_type=False,
)

GUEST_MESSAGE_CHANNEL_ENUM = postgresql.ENUM(
    "sms",
    "whatsapp",
    "email",
    "in_app",
    name="ops_guest_message_channel",
    create_type=False,
)

GUEST_MESSAGE_DIRECTION_ENUM = postgresql.ENUM(
    "in",
    "out",
    name="ops_guest_message_direction",
    create_type=False,
)


def _create_enum_type(name: str, values_sql: str) -> None:
    # Alembic runs table DDL with checkfirst=False; create enums explicitly.
    op.execute(
        f"""
        do $$
        begin
          create type {name} as enum ({values_sql});
        exception
          when duplicate_object then null;
        end $$;
        """
    )


def _enable_rls(full_table_name: str, policy_name: str) -> None:
    op.execute(f"alter table {full_table_name} enable row level security")
    op.execute(f"alter table {full_table_name} force row level security")
    op.execute(
        f"""
        create policy {policy_name} on {full_table_name}
        using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        """
    )


def _updated_at_trigger(full_table_name: str, trigger_name: str) -> None:
    # public.set_updated_at() is created in 20260522_0008_extend_properties_for_admin.
    op.execute(f"drop trigger if exists {trigger_name} on {full_table_name}")
    op.execute(
        f"""
        create trigger {trigger_name}
        before update on {full_table_name}
        for each row execute function public.set_updated_at();
        """
    )


def upgrade() -> None:
    op.execute("create schema if not exists ops")

    _create_enum_type(
        "ops_room_status",
        "'vacant_clean','vacant_dirty','occupied','inspected','out_of_order'",
    )
    _create_enum_type("ops_guest_language", "'en','fr'")
    _create_enum_type(
        "ops_reservation_status",
        "'booked','checked_in','checked_out','cancelled','no_show'",
    )
    _create_enum_type(
        "ops_action_queue_type",
        "'request','incident','system_alert','vip','task'",
    )
    _create_enum_type(
        "ops_action_queue_status",
        "'pending','assigned','in_progress','urgent','completed','cancelled'",
    )
    _create_enum_type("ops_action_queue_severity", "'low','medium','high','urgent'")
    _create_enum_type(
        "ops_front_desk_event_kind",
        "'queue_joined','served','checked_in','walk_in'",
    )
    _create_enum_type("ops_shift_label", "'morning','afternoon','night'")
    _create_enum_type(
        "ops_housekeeping_assignment_status",
        "'queued','in_progress','done','inspected','break','dnd'",
    )
    _create_enum_type("ops_menu_service", "'breakfast','restaurant','room_service'")
    _create_enum_type(
        "ops_room_service_order_status",
        "'received','preparing','en_route','delivered','cancelled'",
    )
    _create_enum_type("ops_meeting_setup_status", "'setup','ready','in_use','breakdown','done'")
    _create_enum_type("ops_guest_message_channel", "'sms','whatsapp','email','in_app'")
    _create_enum_type("ops_guest_message_direction", "'in','out'")

    op.create_table(
        "rooms",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("room_number", sa.String(length=32), nullable=False),
        sa.Column("floor", sa.Integer(), nullable=True),
        sa.Column("type", sa.String(length=64), nullable=True),
        sa.Column("status", ROOM_STATUS_ENUM, nullable=False, server_default=sa.text("'vacant_clean'")),
        sa.Column("current_reservation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("last_service_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("vip", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("org_id", "room_number", name="uq_ops_rooms_org_room_number"),
        schema="ops",
    )
    op.create_index("ix_ops_rooms_org_status", "rooms", ["org_id", "status"], schema="ops")
    op.create_index("ix_ops_rooms_org_floor", "rooms", ["org_id", "floor"], schema="ops")
    _enable_rls("ops.rooms", "ops_rooms_org_isolation")
    _updated_at_trigger("ops.rooms", "trg_ops_rooms_set_updated_at")

    op.create_table(
        "guests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("first_name", sa.String(length=120), nullable=False),
        sa.Column("last_name", sa.String(length=120), nullable=False),
        sa.Column("vip", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("language", GUEST_LANGUAGE_ENUM, nullable=False, server_default=sa.text("'en'")),
        sa.Column("phone_e164", sa.String(length=32), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("preferences_json", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        schema="ops",
    )
    op.create_index(
        "ix_ops_guests_org_last_first",
        "guests",
        ["org_id", "last_name", "first_name"],
        schema="ops",
    )
    op.create_index("ix_ops_guests_org_email", "guests", ["org_id", "email"], schema="ops")
    op.create_index("ix_ops_guests_org_phone", "guests", ["org_id", "phone_e164"], schema="ops")
    _enable_rls("ops.guests", "ops_guests_org_isolation")
    _updated_at_trigger("ops.guests", "trg_ops_guests_set_updated_at")

    op.create_table(
        "reservations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("guest_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("room_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", RESERVATION_STATUS_ENUM, nullable=False, server_default=sa.text("'booked'")),
        sa.Column("check_in_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("check_out_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rate_cents", sa.Integer(), nullable=True),
        sa.Column("group_id", sa.String(length=64), nullable=True),
        sa.Column("source", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["guest_id"], ["ops.guests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["room_id"], ["ops.rooms.id"], ondelete="SET NULL"),
        schema="ops",
    )
    op.create_index(
        "ix_ops_reservations_org_property_check_in",
        "reservations",
        ["org_id", "property_id", "check_in_at"],
        schema="ops",
    )
    op.create_index(
        "ix_ops_reservations_org_room_check_in",
        "reservations",
        ["org_id", "room_id", "check_in_at"],
        schema="ops",
    )
    op.create_index(
        "ix_ops_reservations_org_status_check_in",
        "reservations",
        ["org_id", "status", "check_in_at"],
        schema="ops",
    )
    _enable_rls("ops.reservations", "ops_reservations_org_isolation")
    _updated_at_trigger("ops.reservations", "trg_ops_reservations_set_updated_at")

    op.create_foreign_key(
        "fk_ops_rooms_current_reservation_id",
        "rooms",
        "reservations",
        ["current_reservation_id"],
        ["id"],
        source_schema="ops",
        referent_schema="ops",
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_ops_rooms_org_current_reservation",
        "rooms",
        ["org_id", "current_reservation_id"],
        schema="ops",
    )

    op.create_table(
        "action_queue",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type", ACTION_QUEUE_TYPE_ENUM, nullable=False),
        sa.Column("source", sa.String(length=180), nullable=True),
        sa.Column("room_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("guest_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column(
            "status",
            ACTION_QUEUE_STATUS_ENUM,
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column(
            "severity",
            ACTION_QUEUE_SEVERITY_ENUM,
            nullable=False,
            server_default=sa.text("'low'"),
        ),
        sa.Column("assigned_to_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("sla_due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("parent_incident_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["room_id"], ["ops.rooms.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["guest_id"], ["ops.guests.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["assigned_to_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["parent_incident_id"], ["ops.action_queue.id"], ondelete="SET NULL"),
        schema="ops",
    )
    op.create_index(
        "ix_ops_action_queue_org_status_severity_sla",
        "action_queue",
        ["org_id", "status", "severity", "sla_due_at"],
        schema="ops",
    )
    op.create_index(
        "ix_ops_action_queue_org_room_status",
        "action_queue",
        ["org_id", "room_id", "status"],
        schema="ops",
    )
    _enable_rls("ops.action_queue", "ops_action_queue_org_isolation")
    _updated_at_trigger("ops.action_queue", "trg_ops_action_queue_set_updated_at")

    op.create_table(
        "front_desk_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", FRONT_DESK_EVENT_KIND_ENUM, nullable=False),
        sa.Column("guest_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reservation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("queue_position", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["guest_id"], ["ops.guests.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reservation_id"], ["ops.reservations.id"], ondelete="SET NULL"),
        schema="ops",
    )
    op.create_index(
        "ix_ops_front_desk_events_org_started_at",
        "front_desk_events",
        ["org_id", "started_at"],
        schema="ops",
    )
    _enable_rls("ops.front_desk_events", "ops_front_desk_events_org_isolation")
    _updated_at_trigger("ops.front_desk_events", "trg_ops_front_desk_events_set_updated_at")

    op.create_table(
        "shift_handover",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("shift_date", sa.Date(), nullable=False),
        sa.Column("shift_label", SHIFT_LABEL_ENUM, nullable=False),
        sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("summary_md", sa.Text(), nullable=True),
        sa.Column("checklist_json", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("signed_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("carry_forward_from_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["signed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["carry_forward_from_id"], ["ops.shift_handover.id"], ondelete="SET NULL"
        ),
        schema="ops",
    )
    op.create_index(
        "ix_ops_shift_handover_org_property_date_label",
        "shift_handover",
        ["org_id", "property_id", "shift_date", "shift_label"],
        schema="ops",
    )
    _enable_rls("ops.shift_handover", "ops_shift_handover_org_isolation")
    _updated_at_trigger("ops.shift_handover", "trg_ops_shift_handover_set_updated_at")

    op.create_table(
        "housekeeping_assignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("attendant_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("room_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "status",
            HOUSEKEEPING_ASSIGNMENT_STATUS_ENUM,
            nullable=False,
            server_default=sa.text("'queued'"),
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["attendant_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["room_id"], ["ops.rooms.id"], ondelete="CASCADE"),
        schema="ops",
    )
    op.create_index(
        "ix_ops_housekeeping_assignments_org_status_room",
        "housekeeping_assignments",
        ["org_id", "status", "room_id"],
        schema="ops",
    )
    _enable_rls("ops.housekeeping_assignments", "ops_housekeeping_assignments_org_isolation")
    _updated_at_trigger(
        "ops.housekeeping_assignments",
        "trg_ops_housekeeping_assignments_set_updated_at",
    )

    op.create_table(
        "menu_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("service", MENU_SERVICE_ENUM, nullable=False),
        sa.Column("name_en", sa.String(length=180), nullable=False),
        sa.Column("name_fr", sa.String(length=180), nullable=True),
        sa.Column("price_cents", sa.Integer(), nullable=False),
        sa.Column(
            "allergens",
            postgresql.ARRAY(sa.String(length=64)),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.Column("available", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        schema="ops",
    )
    op.create_index(
        "ix_ops_menu_items_org_service_available",
        "menu_items",
        ["org_id", "service", "available"],
        schema="ops",
    )
    _enable_rls("ops.menu_items", "ops_menu_items_org_isolation")
    _updated_at_trigger("ops.menu_items", "trg_ops_menu_items_set_updated_at")

    op.create_table(
        "room_service_orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("room_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("guest_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("items_json", postgresql.JSONB, nullable=False),
        sa.Column(
            "status",
            ROOM_SERVICE_ORDER_STATUS_ENUM,
            nullable=False,
            server_default=sa.text("'received'"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["room_id"], ["ops.rooms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["guest_id"], ["ops.guests.id"], ondelete="SET NULL"),
        schema="ops",
    )
    op.create_index(
        "ix_ops_room_service_orders_org_status_created_at",
        "room_service_orders",
        ["org_id", "status", "created_at"],
        schema="ops",
    )
    _enable_rls("ops.room_service_orders", "ops_room_service_orders_org_isolation")
    _updated_at_trigger("ops.room_service_orders", "trg_ops_room_service_orders_set_updated_at")

    op.create_table(
        "meeting_rooms",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.Column(
            "equipment",
            postgresql.ARRAY(sa.String(length=64)),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        schema="ops",
    )
    op.create_index("ix_ops_meeting_rooms_org_name", "meeting_rooms", ["org_id", "name"], schema="ops")
    _enable_rls("ops.meeting_rooms", "ops_meeting_rooms_org_isolation")
    _updated_at_trigger("ops.meeting_rooms", "trg_ops_meeting_rooms_set_updated_at")

    op.create_table(
        "meeting_bookings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("meeting_room_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organizer_guest_id_or_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("attendees_count", sa.Integer(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "setup_status",
            MEETING_SETUP_STATUS_ENUM,
            nullable=False,
            server_default=sa.text("'setup'"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["meeting_room_id"], ["ops.meeting_rooms.id"], ondelete="CASCADE"),
        schema="ops",
    )
    op.create_index(
        "ix_ops_meeting_bookings_org_room_starts_at",
        "meeting_bookings",
        ["org_id", "meeting_room_id", "starts_at"],
        schema="ops",
    )
    _enable_rls("ops.meeting_bookings", "ops_meeting_bookings_org_isolation")
    _updated_at_trigger("ops.meeting_bookings", "trg_ops_meeting_bookings_set_updated_at")

    op.create_table(
        "spa_appointments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("guest_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("service", sa.String(length=120), nullable=False),
        sa.Column("therapist_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["guest_id"], ["ops.guests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["therapist_user_id"], ["users.id"], ondelete="SET NULL"),
        schema="ops",
    )
    op.create_index(
        "ix_ops_spa_appointments_org_starts_at",
        "spa_appointments",
        ["org_id", "starts_at"],
        schema="ops",
    )
    _enable_rls("ops.spa_appointments", "ops_spa_appointments_org_isolation")
    _updated_at_trigger("ops.spa_appointments", "trg_ops_spa_appointments_set_updated_at")

    op.create_table(
        "fitness_classes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("instructor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.Column("attended_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["instructor_user_id"], ["users.id"], ondelete="SET NULL"),
        schema="ops",
    )
    op.create_index(
        "ix_ops_fitness_classes_org_starts_at",
        "fitness_classes",
        ["org_id", "starts_at"],
        schema="ops",
    )
    _enable_rls("ops.fitness_classes", "ops_fitness_classes_org_isolation")
    _updated_at_trigger("ops.fitness_classes", "trg_ops_fitness_classes_set_updated_at")

    op.create_table(
        "guest_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("thread_id", sa.String(length=128), nullable=False),
        sa.Column("channel", GUEST_MESSAGE_CHANNEL_ENUM, nullable=False),
        sa.Column("direction", GUEST_MESSAGE_DIRECTION_ENUM, nullable=False),
        sa.Column("guest_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["guest_id"], ["ops.guests.id"], ondelete="CASCADE"),
        schema="ops",
    )
    op.create_index(
        "ix_ops_guest_messages_org_thread_sent_at",
        "guest_messages",
        ["org_id", "thread_id", "sent_at"],
        schema="ops",
    )
    op.create_index(
        "ix_ops_guest_messages_org_guest_sent_at",
        "guest_messages",
        ["org_id", "guest_id", "sent_at"],
        schema="ops",
    )
    _enable_rls("ops.guest_messages", "ops_guest_messages_org_isolation")
    _updated_at_trigger("ops.guest_messages", "trg_ops_guest_messages_set_updated_at")

    op.create_table(
        "guest_message_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("language", GUEST_LANGUAGE_ENUM, nullable=False),
        sa.Column("body_template", sa.Text(), nullable=False),
        sa.Column(
            "variables",
            postgresql.ARRAY(sa.String(length=64)),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        schema="ops",
    )
    op.create_index(
        "ix_ops_guest_message_templates_org_name_language",
        "guest_message_templates",
        ["org_id", "name", "language"],
        schema="ops",
    )
    _enable_rls("ops.guest_message_templates", "ops_guest_message_templates_org_isolation")
    _updated_at_trigger(
        "ops.guest_message_templates",
        "trg_ops_guest_message_templates_set_updated_at",
    )


def downgrade() -> None:
    schema = "ops"

    def _drop_table(table: str) -> None:
        full = f"{schema}.{table}"
        op.execute(f"drop trigger if exists trg_{schema}_{table}_set_updated_at on {full}")
        op.execute(f"drop policy if exists {schema}_{table}_org_isolation on {full}")
        op.drop_table(table, schema=schema)

    # Drop in dependency order.
    for table in [
        "guest_message_templates",
        "guest_messages",
        "fitness_classes",
        "spa_appointments",
        "meeting_bookings",
        "meeting_rooms",
        "room_service_orders",
        "menu_items",
        "housekeeping_assignments",
        "shift_handover",
        "front_desk_events",
        "action_queue",
    ]:
        _drop_table(table)

    # ops.rooms has a back-reference to ops.reservations; drop it before reservations.
    op.execute("drop index if exists ops.ix_ops_rooms_org_current_reservation")
    op.execute("alter table ops.rooms drop constraint if exists fk_ops_rooms_current_reservation_id")

    _drop_table("reservations")
    _drop_table("rooms")
    _drop_table("guests")

    # Drop types last.
    for enum_type in [
        "ops_guest_message_direction",
        "ops_guest_message_channel",
        "ops_meeting_setup_status",
        "ops_room_service_order_status",
        "ops_menu_service",
        "ops_housekeeping_assignment_status",
        "ops_shift_label",
        "ops_front_desk_event_kind",
        "ops_action_queue_severity",
        "ops_action_queue_status",
        "ops_action_queue_type",
        "ops_reservation_status",
        "ops_guest_language",
        "ops_room_status",
    ]:
        op.execute(f"drop type if exists {enum_type}")

    op.execute("drop schema if exists ops")

