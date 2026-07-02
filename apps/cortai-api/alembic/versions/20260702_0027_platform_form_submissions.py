"""platform.form_submissions — submission records for form engine

Revision ID: 20260702_0027
Revises: 20260702_0026
Create Date: 2026-07-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260702_0027"
down_revision: str | None = "20260702_0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        do $$
        begin
          create type platform.form_submission_status
            as enum ('draft', 'submitted', 'reviewed', 'archived');
        exception
          when duplicate_object then null;
        end $$;
        """
    )

    op.create_table(
        "form_submissions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("form_definition_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("form_version", sa.Integer(), nullable=False),
        sa.Column("submitted_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("submitted_by_guest_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "payload_json",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("source_property_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "status",
            postgresql.ENUM(
                "draft",
                "submitted",
                "reviewed",
                "archived",
                name="form_submission_status",
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
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["form_definition_id"],
            ["platform.form_definitions.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["submitted_by_user_id"], ["users.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["source_property_id"], ["properties.id"], ondelete="SET NULL"
        ),
        schema="platform",
    )

    op.create_index(
        "ix_platform_form_submissions_org_form",
        "form_submissions",
        ["org_id", "form_definition_id", "created_at"],
        schema="platform",
    )
    op.create_index(
        "ix_platform_form_submissions_org_user",
        "form_submissions",
        ["org_id", "submitted_by_user_id", "created_at"],
        schema="platform",
    )
    op.create_index(
        "ix_platform_form_submissions_org_status",
        "form_submissions",
        ["org_id", "status", "created_at"],
        schema="platform",
    )

    op.execute("alter table platform.form_submissions enable row level security")
    op.execute("alter table platform.form_submissions force row level security")
    op.execute(
        """
        create policy platform_form_submissions_org_isolation on platform.form_submissions
        using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        """
    )

    op.execute(
        """
        create or replace function platform.form_submissions_set_updated_at()
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
        create trigger trg_platform_form_submissions_set_updated_at
        before update on platform.form_submissions
        for each row execute function platform.form_submissions_set_updated_at();
        """
    )


def downgrade() -> None:
    op.execute(
        "drop trigger if exists trg_platform_form_submissions_set_updated_at"
        " on platform.form_submissions"
    )
    op.execute("drop function if exists platform.form_submissions_set_updated_at")
    op.execute(
        "drop policy if exists platform_form_submissions_org_isolation"
        " on platform.form_submissions"
    )
    op.drop_index(
        "ix_platform_form_submissions_org_status",
        table_name="form_submissions",
        schema="platform",
    )
    op.drop_index(
        "ix_platform_form_submissions_org_user",
        table_name="form_submissions",
        schema="platform",
    )
    op.drop_index(
        "ix_platform_form_submissions_org_form",
        table_name="form_submissions",
        schema="platform",
    )
    op.drop_table("form_submissions", schema="platform")
    op.execute("drop type if exists platform.form_submission_status")