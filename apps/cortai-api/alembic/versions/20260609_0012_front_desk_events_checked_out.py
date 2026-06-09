"""add checked_out to front desk events kind enum

Revision ID: 20260609_0012
Revises: 20260604_0011
Create Date: 2026-06-09
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260609_0012"
down_revision: str | None = "20260604_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Enum value additions are effectively irreversible in Postgres.
    # Postgres may require running this outside a transaction.
    with op.get_context().autocommit_block():
        op.execute("alter type ops_front_desk_event_kind add value if not exists 'checked_out'")


def downgrade() -> None:
    pass

