"""BR-15 / NFR-SEC-05 audit change log

Revision ID: 20260522_0007
Revises: 20260521_0006
Create Date: 2026-05-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260522_0007"
down_revision: str | None = "20260521_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("create schema if not exists audit")

    op.create_table(
        "change_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        # User may later be deleted; keep the audit entry and set user_id to NULL.
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("entity_type", sa.String(length=128), nullable=False),
        # Keep flexible: entities may not be UUID-addressable.
        sa.Column("entity_id", sa.String(length=128), nullable=True),
        sa.Column("before_json", postgresql.JSONB(), nullable=True),
        sa.Column("after_json", postgresql.JSONB(), nullable=True),
        sa.Column(
            "ts",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        schema="audit",
    )

    op.create_index(
        "ix_audit_change_log_org_ts",
        "change_log",
        ["org_id", "ts"],
        schema="audit",
    )
    op.create_index(
        "ix_audit_change_log_org_entity",
        "change_log",
        ["org_id", "entity_type", "entity_id"],
        schema="audit",
    )

    op.execute("alter table audit.change_log enable row level security")
    op.execute("alter table audit.change_log force row level security")
    op.execute(
        """
        create policy audit_change_log_org_isolation on audit.change_log
        using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        """
    )

    # Make audit logs immutable: prevent UPDATE/DELETE.
    op.execute(
        """
        create or replace function audit.prevent_change_log_mutation()
        returns trigger as $$
        begin
          raise exception 'audit.change_log is immutable';
        end;
        $$ language plpgsql;
        """
    )
    op.execute(
        """
        create trigger trg_audit_change_log_immutable
        before update or delete on audit.change_log
        for each row execute function audit.prevent_change_log_mutation();
        """
    )


def downgrade() -> None:
    op.execute("drop trigger if exists trg_audit_change_log_immutable on audit.change_log")
    op.execute("drop function if exists audit.prevent_change_log_mutation")

    op.execute("drop policy if exists audit_change_log_org_isolation on audit.change_log")
    op.drop_index("ix_audit_change_log_org_entity", table_name="change_log", schema="audit")
    op.drop_index("ix_audit_change_log_org_ts", table_name="change_log", schema="audit")
    op.drop_table("change_log", schema="audit")
    op.execute("drop schema if exists audit")

