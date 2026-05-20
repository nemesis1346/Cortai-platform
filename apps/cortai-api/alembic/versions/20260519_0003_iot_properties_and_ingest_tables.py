"""properties + iot hypertables for edge ingest

Revision ID: 20260519_0003
Revises: 20260514_0002
Create Date: 2026-05-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260519_0003"
down_revision: str | None = "20260514_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "properties",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("org_id", "slug", name="uq_properties_org_slug"),
    )
    op.execute("alter table properties enable row level security")
    op.execute("alter table properties force row level security")
    op.execute(
        """
        create policy properties_org_isolation on properties
        using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        """
    )

    op.execute("create schema if not exists iot")

    def _iot_table(table: str) -> None:
        schema = "iot"
        full_name = f"{schema}.{table}"
        op.create_table(
            table,
            sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("property_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("device_id", sa.String(length=128), nullable=False),
            sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
            sa.Column("schema_version", sa.String(length=32), nullable=False),
            sa.Column("payload", postgresql.JSONB, nullable=False),
            sa.Column(
                "ingested_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
            schema=schema,
        )

        op.create_index(
            f"ix_{schema}_{table}_org_prop_device_ts",
            table,
            ["org_id", "property_id", "device_id", "ts"],
            schema=schema,
        )
        op.execute(f"alter table {full_name} enable row level security")
        op.execute(f"alter table {full_name} force row level security")
        op.execute(
            f"""
            create policy {schema}_{table}_org_isolation on {full_name}
            using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
            with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
            """
        )

        op.execute(
            f"select create_hypertable('{full_name}', 'ts', if_not_exists => true, migrate_data => true)"
        )

    _iot_table("camera_detections")
    _iot_table("sensor_readings")
    _iot_table("device_health")
    _iot_table("edge_events")


def downgrade() -> None:
    schema = "iot"
    for table in ["edge_events", "device_health", "sensor_readings", "camera_detections"]:
        full_name = f"{schema}.{table}"
        op.execute(f"drop policy if exists {schema}_{table}_org_isolation on {full_name}")
        op.drop_index(f"ix_{schema}_{table}_org_prop_device_ts", table_name=table, schema=schema)
        op.drop_table(table, schema=schema)

    op.execute("drop schema if exists iot")

    op.execute("drop policy if exists properties_org_isolation on properties")
    op.drop_table("properties")

