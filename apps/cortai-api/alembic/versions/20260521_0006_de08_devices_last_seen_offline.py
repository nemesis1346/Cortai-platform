"""DE-08 device last-seen + offline tracking

Revision ID: 20260521_0006
Revises: 20260521_0005
Create Date: 2026-05-21
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260521_0006"
down_revision: str | None = "20260521_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "devices",
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        schema="platform",
    )
    op.add_column(
        "devices",
        sa.Column("is_offline", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        schema="platform",
    )
    op.add_column(
        "devices",
        sa.Column("offline_since", sa.DateTime(timezone=True), nullable=True),
        schema="platform",
    )

    op.create_index(
        "ix_platform_devices_org_offline_since",
        "devices",
        ["org_id", "is_offline", "offline_since"],
        schema="platform",
    )
    op.create_index(
        "ix_platform_devices_org_last_seen_at",
        "devices",
        ["org_id", "last_seen_at"],
        schema="platform",
    )


def downgrade() -> None:
    op.drop_index("ix_platform_devices_org_last_seen_at", table_name="devices", schema="platform")
    op.drop_index(
        "ix_platform_devices_org_offline_since", table_name="devices", schema="platform"
    )
    op.drop_column("devices", "offline_since", schema="platform")
    op.drop_column("devices", "is_offline", schema="platform")
    op.drop_column("devices", "last_seen_at", schema="platform")

