"""AUDIT-02 — convert audit.change_log to TimescaleDB hypertable with 7-year retention

Revision ID: 20260703_0029
Revises: 20260702_0028
Create Date: 2026-07-03

Policy summary
--------------
- Chunk interval  : 1 month  (balances chunk count vs. query pruning)
- Compression     : NOT enabled — TimescaleDB columnstore compression is
  incompatible with PostgreSQL RLS, which audit.change_log requires.
- Retention       : drop chunks older than 7 years (PHIPA/PIPEDA minimum)

Downgrade note
--------------
TimescaleDB provides no `uncreate_hypertable`. The downgrade removes the
retention policy and restores the original PK; the hypertable structure
is left intact. A full rollback requires a manual pg_dump/restore cycle.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "20260703_0029"
down_revision: str = "20260702_0028"
branch_labels = None
depends_on = None

_CHUNK_INTERVAL = "1 month"
_RETAIN_FOR = "7 years"


def upgrade() -> None:
    conn = op.get_bind()

    # 1 — Ensure the TimescaleDB extension is present.
    conn.execute(sa.text(
        "CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE"
    ))

    # 2 — TimescaleDB requires the partition column (ts) to be part of any
    #     unique index or primary key. Drop the id-only PK and replace it
    #     with a composite (id, ts) PK before converting to a hypertable.
    conn.execute(sa.text(
        "ALTER TABLE audit.change_log DROP CONSTRAINT change_log_pkey"
    ))
    conn.execute(sa.text(
        "ALTER TABLE audit.change_log ADD PRIMARY KEY (id, ts)"
    ))

    # 3 — Convert to hypertable. migrate_data moves existing rows into chunks.
    #     if_not_exists is a safety net for re-runs.
    # Note: INTERVAL literals cannot be passed as bound params to TimescaleDB
    # function calls via asyncpg — embed constants directly (not user input).
    conn.execute(sa.text(
        f"SELECT create_hypertable("
        f"  'audit.change_log', 'ts',"
        f"  chunk_time_interval => INTERVAL '{_CHUNK_INTERVAL}',"
        f"  if_not_exists => TRUE,"
        f"  migrate_data => TRUE"
        f")"
    ))

    # 4 — Retention policy: drop chunks older than 7 years.
    #     Compression is intentionally omitted — TimescaleDB columnstore
    #     compression is incompatible with tables that have RLS enabled.
    conn.execute(sa.text(
        f"SELECT add_retention_policy("
        f"  'audit.change_log', INTERVAL '{_RETAIN_FOR}', if_not_exists => TRUE"
        f")"
    ))


def downgrade() -> None:
    conn = op.get_bind()

    # Remove retention policy — hypertable structure cannot be fully reversed by Alembic.
    conn.execute(sa.text(
        "SELECT remove_retention_policy('audit.change_log', if_not_exists => TRUE)"
    ))
    # Restore original single-column primary key.
    conn.execute(sa.text(
        "ALTER TABLE audit.change_log DROP CONSTRAINT change_log_pkey"
    ))
    conn.execute(sa.text(
        "ALTER TABLE audit.change_log ADD PRIMARY KEY (id)"
    ))