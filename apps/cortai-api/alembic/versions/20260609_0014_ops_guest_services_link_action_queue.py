"""link guest services requests to action_queue items

Revision ID: 20260609_0014
Revises: 20260609_0013
Create Date: 2026-06-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260609_0014"
down_revision: str | None = "20260609_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "guest_service_requests",
        sa.Column("action_queue_item_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="ops",
    )
    op.create_foreign_key(
        "fk_ops_guest_service_action_queue_item_id",
        "guest_service_requests",
        "action_queue",
        ["action_queue_item_id"],
        ["id"],
        source_schema="ops",
        referent_schema="ops",
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_ops_guest_service_org_property_action_queue_item",
        "guest_service_requests",
        ["org_id", "property_id", "action_queue_item_id"],
        schema="ops",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ops_guest_service_org_property_action_queue_item",
        table_name="guest_service_requests",
        schema="ops",
    )
    op.drop_constraint(
        "fk_ops_guest_service_action_queue_item_id",
        "guest_service_requests",
        schema="ops",
        type_="foreignkey",
    )
    op.drop_column("guest_service_requests", "action_queue_item_id", schema="ops")

