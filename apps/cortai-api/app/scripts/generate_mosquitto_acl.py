from __future__ import annotations

import argparse
from pathlib import Path

import asyncpg
import structlog

from app.config import get_settings

logger = structlog.get_logger(__name__)


def _dsn_for_asyncpg(database_url: str) -> str:
    if database_url.startswith("postgresql+asyncpg://"):
        return database_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    return database_url


async def _set_current_org(conn: asyncpg.Connection, org_id: str) -> None:
    # Mirrors app.db.set_current_org, but keeps this script dependency-free.
    # IMPORTANT: `is_local=false` so the setting persists for this connection/session
    # across subsequent statements. Using `true` would only apply within the current
    # transaction (one statement in autocommit), and RLS-protected tables would appear empty.
    await conn.execute("select set_config('app.current_org_id', $1, false)", org_id)


def _render_acl(*, device_rules: list[str]) -> str:
    lines: list[str] = []
    lines.append("# Mosquitto ACL file (generated)")
    lines.append("#")
    lines.append("# This file is generated from the devices registry (platform.devices) to enforce")
    lines.append("# multi-tenant isolation at the broker.")
    lines.append("#")
    lines.append("# Topics: cortai/{org_slug}/{property_slug}/edge/{device_id}/{type}")
    lines.append("#")
    lines.append("# SECURITY:")
    lines.append("# - No wildcard is allowed for {org_slug} for device clients.")
    lines.append("# - {property_slug} is pinned when the device is bound to a property_id; otherwise")
    lines.append("#   the device is allowed within its org across properties (still tenant-isolated).")
    lines.append("")
    lines.append("# Ingest service (privileged): can read all device topics.")
    lines.append("user edge-ingest")
    lines.append("topic read cortai/+/+/edge/+/+")
    lines.append("")
    lines.extend(device_rules)
    lines.append("")
    return "\n".join(lines)


async def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Mosquitto ACL from platform.devices")
    parser.add_argument(
        "--out",
        default="deploy/mosquitto/aclfile",
        help="Output path for the generated aclfile (default: deploy/mosquitto/aclfile)",
    )
    args = parser.parse_args()

    settings = get_settings()
    dsn = _dsn_for_asyncpg(settings.database_url)

    out_path = Path(args.out)
    if not out_path.is_absolute():
        # Resolve relative to repo root when run from /opt/cortai/apps/cortai-api
        out_path = (Path.cwd().parent.parent / out_path).resolve()

    conn = await asyncpg.connect(dsn)
    try:
        org_rows = await conn.fetch("select id::text as org_id, slug from organizations order by slug asc")
        device_id_to_org_slug: dict[str, str] = {}
        device_rules: list[str] = []
        duplicate_device_ids: list[str] = []

        for org in org_rows:
            org_id = str(org["org_id"])
            org_slug = str(org["slug"])

            await _set_current_org(conn, org_id)

            devices = await conn.fetch(
                """
                select d.device_id,
                       d.property_id::text as property_id,
                       p.slug as property_slug
                from platform.devices d
                left join properties p on p.id = d.property_id
                where d.org_id = $1
                order by d.device_id asc
                """,
                org_id,
            )

            for d in devices:
                device_id = str(d["device_id"])
                prop_id = d["property_id"]
                prop_slug = str(d["property_slug"]) if d["property_slug"] is not None else None

                # Mosquitto mTLS setup uses `use_identity_as_username true`, so username == device_id.
                # That requires device_id to be globally unique; otherwise two tenants would collide.
                prior = device_id_to_org_slug.get(device_id)
                if prior is not None and prior != org_slug:
                    duplicate_device_ids.append(device_id)
                    continue
                device_id_to_org_slug[device_id] = org_slug

                device_rules.append(f"user {device_id}")
                if prop_slug:
                    device_rules.append(
                        f"topic readwrite cortai/{org_slug}/{prop_slug}/edge/{device_id}/+"
                    )
                else:
                    device_rules.append(f"topic readwrite cortai/{org_slug}/+/edge/{device_id}/+")
                device_rules.append("")

        if duplicate_device_ids:
            dup_preview = ", ".join(sorted(set(duplicate_device_ids))[:10])
            raise RuntimeError(
                "Duplicate device_id across orgs detected (must be globally unique for broker identity). "
                f"Examples: {dup_preview}"
            )

        rendered = _render_acl(device_rules=device_rules)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = out_path.with_suffix(out_path.suffix + ".tmp")
        tmp.write_text(rendered, encoding="utf-8")
        tmp.replace(out_path)

        logger.info("mosquitto_acl.generated", out=str(out_path), device_rules=len(device_id_to_org_slug))
    finally:
        await conn.close()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())

