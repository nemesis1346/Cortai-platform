"""ops guest messages language

Revision ID: 20260610_0023
Revises: 20260610_0022
Create Date: 2026-06-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260610_0023"
down_revision: str | None = "20260610_0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "guest_messages",
        sa.Column(
            "language",
            postgresql.ENUM(name="ops_guest_language", create_type=False),
            nullable=True,
        ),
        schema="ops",
    )
    # Backfill from guest profile language when possible, else default to 'en'.
    op.execute(
        """
        update ops.guest_messages m
        set language = coalesce(g.language, 'en'::ops_guest_language)
        from ops.guests g
        where m.guest_id = g.id
          and m.org_id = g.org_id
          and m.language is null
        """
    )
    op.execute(
        """
        update ops.guest_messages
        set language = 'en'::ops_guest_language
        where language is null
        """
    )
    op.alter_column("guest_messages", "language", nullable=False, schema="ops")
    op.create_index(
        "ix_ops_guest_messages_org_thread_sent_at_lang",
        "guest_messages",
        ["org_id", "thread_id", "sent_at", "language"],
        schema="ops",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ops_guest_messages_org_thread_sent_at_lang",
        table_name="guest_messages",
        schema="ops",
    )
    op.drop_column("guest_messages", "language", schema="ops")

