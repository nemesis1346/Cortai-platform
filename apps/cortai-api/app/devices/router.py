import uuid

from fastapi import APIRouter, Query
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep
from app.devices.schemas import DevicePublicRead

router = APIRouter(prefix="/api/devices", tags=["devices"])


@router.get("", response_model=list[DevicePublicRead])
async def list_devices(
    principal: PrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID | None = Query(default=None),
) -> list[DevicePublicRead]:
    # Do not rely purely on RLS here: some deployments/test DB roles may bypass RLS.
    params: dict[str, object] = {"org_id": str(principal.org_id)}
    where_parts = ["org_id = :org_id"]
    if property_id is not None:
        where_parts.append("property_id = :property_id")
        params["property_id"] = str(property_id)

    where = "where " + " and ".join(where_parts)
    rows = (
        await session.execute(
            text(
                f"""
                select id, property_id, device_id, type, capabilities, logical_bindings,
                       last_seen_at, is_offline, offline_since, created_at, updated_at
                from platform.devices
                {where}
                order by created_at desc
                """  # noqa: S608
            ),
            params,
        )
    ).mappings().all()

    # Ensure we never include hardware identity fields here.
    return [DevicePublicRead(**dict(r)) for r in rows]

