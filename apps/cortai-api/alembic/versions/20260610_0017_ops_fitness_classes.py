"""ops fitness classes

Revision ID: 20260610_0017
Revises: 20260610_0016
Create Date: 2026-06-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op
from sqlalchemy import text

revision: str = "20260610_0017"
down_revision: str | None = "20260610_0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    exists = conn.execute(
        text(
            """
            select 1
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'ops'
              and c.relname = 'fitness_classes'
            """
        )
    ).first()

    def has_column(col: str) -> bool:
        return (
            conn.execute(
                text(
                    """
                    select 1
                    from information_schema.columns
                    where table_schema = 'ops'
                      and table_name = 'fitness_classes'
                      and column_name = :col
                    """
                ),
                {"col": col},
            ).first()
            is not None
        )

    if exists is None:
        op.create_table(
            "fitness_classes",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("name", sa.String(length=180), nullable=False),
            sa.Column("instructor_name", sa.String(length=180), nullable=True),
            sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("capacity", sa.Integer(), nullable=False),
            sa.Column("booked", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("location", sa.String(length=180), nullable=True),
            sa.Column("description", sa.String(length=500), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False, server_default=sa.text("'scheduled'")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
            schema="ops",
        )
    else:
        # Existing table (likely from a prior experiment). Ensure columns required by the API exist.
        if not has_column("org_id"):
            raise RuntimeError("ops.fitness_classes exists but is missing org_id; cannot safely migrate")

        if not has_column("property_id"):
            op.add_column(
                "fitness_classes",
                sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=True),
                schema="ops",
            )
            # Best-effort backfill: default each org's rows to the org's first property.
            op.execute(
                """
                with first_prop as (
                  select distinct on (org_id) org_id, id as property_id
                  from properties
                  order by org_id, created_at asc, id asc
                )
                update ops.fitness_classes fc
                set property_id = fp.property_id
                from first_prop fp
                where fc.org_id = fp.org_id
                  and fc.property_id is null
                """
            )
            # Only enforce NOT NULL if everything backfilled.
            nulls = conn.execute(text("select count(*) from ops.fitness_classes where property_id is null")).scalar()
            if int(nulls or 0) == 0:
                op.alter_column("fitness_classes", "property_id", nullable=False, schema="ops")

        if not has_column("name"):
            op.add_column(
                "fitness_classes",
                sa.Column("name", sa.String(length=180), nullable=False, server_default=sa.text("'Fitness class'")),
                schema="ops",
            )
        if not has_column("instructor_name"):
            op.add_column("fitness_classes", sa.Column("instructor_name", sa.String(length=180), nullable=True), schema="ops")
        if not has_column("starts_at"):
            op.add_column(
                "fitness_classes",
                sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
                schema="ops",
            )
        if not has_column("ends_at"):
            op.add_column(
                "fitness_classes",
                sa.Column(
                    "ends_at",
                    sa.DateTime(timezone=True),
                    nullable=False,
                    server_default=sa.text("now() + interval '1 hour'"),
                ),
                schema="ops",
            )
        if not has_column("capacity"):
            op.add_column(
                "fitness_classes",
                sa.Column("capacity", sa.Integer(), nullable=False, server_default=sa.text("0")),
                schema="ops",
            )
        if not has_column("booked"):
            op.add_column(
                "fitness_classes",
                sa.Column("booked", sa.Integer(), nullable=False, server_default=sa.text("0")),
                schema="ops",
            )
        if not has_column("location"):
            op.add_column("fitness_classes", sa.Column("location", sa.String(length=180), nullable=True), schema="ops")
        if not has_column("description"):
            op.add_column("fitness_classes", sa.Column("description", sa.String(length=500), nullable=True), schema="ops")
        if not has_column("status"):
            op.add_column(
                "fitness_classes",
                sa.Column("status", sa.String(length=32), nullable=False, server_default=sa.text("'scheduled'")),
                schema="ops",
            )
        if not has_column("created_at"):
            op.add_column(
                "fitness_classes",
                sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
                schema="ops",
            )
        if not has_column("updated_at"):
            op.add_column(
                "fitness_classes",
                sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
                schema="ops",
            )

        # Add FK to properties if missing and column is present.
        if has_column("property_id"):
            op.execute(
                """
                do $$
                begin
                  if not exists (
                    select 1
                    from pg_constraint
                    where conname = 'fk_ops_fitness_classes_property_id'
                  ) then
                    alter table ops.fitness_classes
                    add constraint fk_ops_fitness_classes_property_id
                    foreign key (property_id) references properties(id) on delete cascade;
                  end if;
                end
                $$;
                """
            )

    # Index only when the required columns exist.
    if has_column("org_id") and has_column("property_id") and has_column("starts_at"):
        op.execute(
            """
            create index if not exists ix_ops_fitness_classes_org_property_starts_at
            on ops.fitness_classes (org_id, property_id, starts_at)
            """
        )

    op.execute("alter table ops.fitness_classes enable row level security")
    op.execute("alter table ops.fitness_classes force row level security")
    op.execute(
        """
        do $$
        begin
          if not exists (
            select 1
            from pg_policies
            where schemaname = 'ops'
              and tablename = 'fitness_classes'
              and policyname = 'ops_fitness_classes_org_isolation'
          ) then
            execute $policy$
              create policy ops_fitness_classes_org_isolation on ops.fitness_classes
              using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
              with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
            $policy$;
          end if;
        end
        $$;
        """
    )
    op.execute("drop trigger if exists trg_ops_fitness_classes_set_updated_at on ops.fitness_classes")
    op.execute(
        """
        create trigger trg_ops_fitness_classes_set_updated_at
        before update on ops.fitness_classes
        for each row execute function public.set_updated_at();
        """
    )


def downgrade() -> None:
    op.execute("drop trigger if exists trg_ops_fitness_classes_set_updated_at on ops.fitness_classes")
    op.execute("drop policy if exists ops_fitness_classes_org_isolation on ops.fitness_classes")
    op.execute("drop index if exists ops.ix_ops_fitness_classes_org_property_starts_at")
    op.drop_table("fitness_classes", schema="ops")

