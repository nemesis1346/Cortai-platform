"""SEC-02 — add password_policy_version + password_changed_at to users

Revision ID: 20260706_0030
Revises: 20260703_0029
Create Date: 2026-07-06

password_policy_version allows forced re-enrolment when the policy changes:
any user whose version < CURRENT_POLICY_VERSION must reset their password.

password_changed_at drives the 180-day IT_ADMIN rotation check surfaced by
GET /api/auth/me (password_rotation_due flag).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "20260706_0030"
down_revision: str = "20260703_0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "password_policy_version",
            sa.SmallInteger(),
            nullable=False,
            server_default="1",
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "password_changed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "password_changed_at")
    op.drop_column("users", "password_policy_version")