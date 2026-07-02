"""platform.form_definitions — JSON Schema form engine

Revision ID: 20260702_0026
Revises: 20260630_0025
Create Date: 2026-07-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260702_0026"
down_revision: str | None = "20260630_0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("create schema if not exists platform")

    op.execute(
        """
        do $$
        begin
          create type platform.form_status as enum ('draft', 'published', 'archived');
        exception
          when duplicate_object then null;
        end $$;
        """
    )

    op.create_table(
        "form_definitions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("title_en", sa.String(length=180), nullable=False),
        sa.Column("title_fr", sa.String(length=180), nullable=False),
        sa.Column(
            "schema_json",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "ui_hints_json",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "status",
            postgresql.ENUM(
                "draft",
                "published",
                "archived",
                name="form_status",
                schema="platform",
                create_type=False,
            ),
            nullable=False,
            server_default=sa.text("'draft'"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "org_id", "slug", "version", name="uq_platform_form_definitions_org_slug_version"
        ),
        schema="platform",
    )

    op.create_index(
        "ix_platform_form_definitions_org_status",
        "form_definitions",
        ["org_id", "status", "created_at"],
        schema="platform",
    )

    op.execute("alter table platform.form_definitions enable row level security")
    op.execute("alter table platform.form_definitions force row level security")
    op.execute(
        """
        create policy platform_form_definitions_org_isolation on platform.form_definitions
        using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        """
    )

    op.execute(
        """
        create or replace function platform.form_definitions_set_updated_at()
        returns trigger as $$
        begin
          new.updated_at = now();
          return new;
        end;
        $$ language plpgsql;
        """
    )
    op.execute(
        """
        create trigger trg_platform_form_definitions_set_updated_at
        before update on platform.form_definitions
        for each row execute function platform.form_definitions_set_updated_at();
        """
    )


def downgrade() -> None:
    op.execute(
        "drop trigger if exists trg_platform_form_definitions_set_updated_at on platform.form_definitions"
    )
    op.execute("drop function if exists platform.form_definitions_set_updated_at")
    op.execute(
        "drop policy if exists platform_form_definitions_org_isolation on platform.form_definitions"
    )
    op.drop_index(
        "ix_platform_form_definitions_org_status",
        table_name="form_definitions",
        schema="platform",
    )
    op.drop_table("form_definitions", schema="platform")
    op.execute("drop type if exists platform.form_status")