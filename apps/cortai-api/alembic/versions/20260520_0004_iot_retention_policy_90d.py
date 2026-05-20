"""add 90-day retention policies for iot hypertables

Revision ID: 20260520_0004
Revises: 20260519_0003
Create Date: 2026-05-20
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260520_0004"
down_revision: str | None = "20260519_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


IOT_TABLES: tuple[str, ...] = (
    "camera_detections",
    "sensor_readings",
    "device_health",
    "edge_events",
)


def upgrade() -> None:
    for table in IOT_TABLES:
        full_name = f"iot.{table}"
        # Be idempotent in case the policy already exists (e.g. recreated env).
        # TimescaleDB function names AND signatures vary by version; instead of trying to
        # precisely match signatures, we attempt the most common call shapes and ignore
        # `undefined_function` (SQLSTATE 42883) until one works.
        op.execute(
            f"""
            do $$
            declare
              ht regclass := '{full_name}'::regclass;
              applied boolean := false;
            begin
              -- Drop/remove existing policy (ignore if function doesn't exist).
              begin perform public.drop_retention_policy(ht, true); exception when undefined_function then null; when others then null; end;
              begin perform public.drop_retention_policy(ht); exception when undefined_function then null; when others then null; end;
              begin perform public.remove_retention_policy(ht, true); exception when undefined_function then null; when others then null; end;
              begin perform public.remove_retention_policy(ht); exception when undefined_function then null; when others then null; end;
              begin perform public.remove_drop_chunks_policy(ht, true); exception when undefined_function then null; when others then null; end;
              begin perform public.remove_drop_chunks_policy(ht); exception when undefined_function then null; when others then null; end;
              begin perform public.drop_drop_chunks_policy(ht); exception when undefined_function then null; when others then null; end;
              begin perform timescaledb_experimental.remove_drop_chunks_policy(ht, true); exception when undefined_function then null; when others then null; end;
              begin perform timescaledb_experimental.remove_drop_chunks_policy(ht); exception when undefined_function then null; when others then null; end;

              -- Add 90-day retention policy.
              begin
                perform public.add_retention_policy(ht, interval '90 days');
                applied := true;
              exception when undefined_function then
                null;
              end;

              if not applied then
                begin
                  perform public.add_retention_policy(ht, interval '90 days', interval '1 day');
                  applied := true;
                exception when undefined_function then
                  null;
                end;
              end if;

              if not applied then
                begin
                  perform public.add_retention_policy(ht::text, interval '90 days');
                  applied := true;
                exception when undefined_function then
                  null;
                end;
              end if;

              if not applied then
                begin
                  perform public.add_drop_chunks_policy(ht, interval '90 days');
                  applied := true;
                exception when undefined_function then
                  null;
                end;
              end if;

              if not applied then
                begin
                  perform public.add_drop_chunks_policy(ht, interval '90 days', interval '1 day');
                  applied := true;
                exception when undefined_function then
                  null;
                end;
              end if;

              if not applied then
                begin
                  perform public.add_drop_chunks_policy(ht::text, interval '90 days');
                  applied := true;
                exception when undefined_function then
                  null;
                end;
              end if;

              if not applied then
                begin
                  perform timescaledb_experimental.add_drop_chunks_policy(ht, interval '90 days');
                  applied := true;
                exception when undefined_function then
                  null;
                end;
              end if;

              if not applied then
                raise exception 'No compatible TimescaleDB retention/drop-chunks policy function found';
              end if;
            end $$;
            """
        )


def downgrade() -> None:
    for table in IOT_TABLES:
        full_name = f"iot.{table}"
        op.execute(
            f"""
            do $$
            declare
              ht regclass := '{full_name}'::regclass;
            begin
              begin perform public.drop_retention_policy(ht, true); exception when undefined_function then null; when others then null; end;
              begin perform public.drop_retention_policy(ht); exception when undefined_function then null; when others then null; end;
              begin perform public.remove_retention_policy(ht, true); exception when undefined_function then null; when others then null; end;
              begin perform public.remove_retention_policy(ht); exception when undefined_function then null; when others then null; end;
              begin perform public.remove_drop_chunks_policy(ht, true); exception when undefined_function then null; when others then null; end;
              begin perform public.remove_drop_chunks_policy(ht); exception when undefined_function then null; when others then null; end;
              begin perform public.drop_drop_chunks_policy(ht); exception when undefined_function then null; when others then null; end;
              begin perform timescaledb_experimental.remove_drop_chunks_policy(ht, true); exception when undefined_function then null; when others then null; end;
              begin perform timescaledb_experimental.remove_drop_chunks_policy(ht); exception when undefined_function then null; when others then null; end;
            end $$;
            """
        )

