"""enable timescaledb, pgvector, postgis extensions

Revision ID: 20260514_0002
Revises: 20260510_0001
Create Date: 2026-05-14
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260514_0002"
down_revision: str | None = "20260510_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Needed for CREATE EXTENSION of some bundled extensions (notably PostGIS).
    op.execute("create extension if not exists plpgsql")
    op.execute("create extension if not exists timescaledb")
    op.execute("create extension if not exists vector")
    op.execute("create extension if not exists postgis")


def downgrade() -> None:
    op.execute("drop extension if exists postgis")
    op.execute("drop extension if exists vector")
    op.execute("drop extension if exists timescaledb")

