import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from app.auth.dependencies import PrincipalDep, require_roles_dep
from app.db import SessionDep
from app.models import UserRole
from app.modules.admin.devices.schemas import DeviceCreate, DeviceList, DeviceRead, DeviceUpdate

router = APIRouter(prefix="/api/admin/devices", tags=["admin-devices"])
ADMIN_ROLES = {UserRole.IT_ADMIN, UserRole.SERVICE_PROVIDER_ADMIN}
AdminPrincipalDep = Annotated[PrincipalDep, Depends(require_roles_dep(ADMIN_ROLES))]


@router.get("", response_model=DeviceList)
async def list_devices(
    principal: AdminPrincipalDep,
    session: SessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    property_id: uuid.UUID | None = None,
    type: str | None = None,  # noqa: A002
) -> DeviceList:
    filters = ["org_id = :org_id"]
    params: dict[str, object] = {"org_id": str(principal.org_id)}
    if property_id is not None:
        filters.append("property_id = :property_id")
        params["property_id"] = str(property_id)
    if type is not None:
        filters.append("type = :type")
        params["type"] = type

    where = " and ".join(filters)
    total = await session.scalar(
        text(f"select count(*) from platform.devices where {where}"),  # noqa: S608
        params,
    )
    rows = (
        await session.execute(
            text(
                f"""
                select id, org_id, property_id, device_id, type, capabilities, cert_fingerprint,
                       logical_bindings, last_seen_at, is_offline, offline_since, created_at, updated_at
                from platform.devices
                where {where}
                order by created_at desc
                offset :offset limit :limit
                """  # noqa: S608
            ),
            {**params, "offset": (page - 1) * page_size, "limit": page_size},
        )
    ).mappings().all()

    return DeviceList(
        items=[DeviceRead(**dict(r)) for r in rows],
        total=int(total or 0),
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=DeviceRead, status_code=status.HTTP_201_CREATED)
async def create_device(
    payload: DeviceCreate,
    principal: AdminPrincipalDep,
    session: SessionDep,
) -> DeviceRead:
    device_uuid = uuid.uuid4()
    now = datetime.now(UTC)
    stmt = text(
        """
        insert into platform.devices (
          id, org_id, property_id, device_id, type, capabilities, cert_fingerprint,
          logical_bindings, last_seen_at, is_offline, offline_since, created_at, updated_at
        )
        values (
          :id, :org_id, :property_id, :device_id, :type, :capabilities, :cert_fingerprint,
          :logical_bindings, null, false, null, :created_at, :updated_at
        )
        returning id, org_id, property_id, device_id, type, capabilities, cert_fingerprint,
                  logical_bindings, last_seen_at, is_offline, offline_since, created_at, updated_at
        """
    ).bindparams(sa.bindparam("logical_bindings", type_=postgresql.JSONB))
    try:
        row = (
            await session.execute(
                stmt,
                {
                    "id": str(device_uuid),
                    "org_id": str(principal.org_id),
                    "property_id": str(payload.property_id) if payload.property_id else None,
                    "device_id": payload.device_id,
                    "type": payload.type,
                    "capabilities": payload.capabilities,
                    "cert_fingerprint": payload.cert_fingerprint,
                    "logical_bindings": payload.logical_bindings,
                    "created_at": now,
                    "updated_at": now,
                },
            )
        ).mappings().one()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    await session.commit()
    return DeviceRead(**dict(row))


@router.patch("/{device_pk}", response_model=DeviceRead)
async def update_device(
    device_pk: uuid.UUID,
    payload: DeviceUpdate,
    principal: AdminPrincipalDep,
    session: SessionDep,
) -> DeviceRead:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    # Build dynamic SET clause safely (named params only).
    sets: list[str] = []
    params: dict[str, object] = {"id": str(device_pk), "org_id": str(principal.org_id)}
    for k, v in data.items():
        if k == "logical_bindings":
            sets.append("logical_bindings = :logical_bindings")
            params["logical_bindings"] = v
        elif k == "property_id":
            sets.append("property_id = :property_id")
            params["property_id"] = str(v) if v else None
        else:
            sets.append(f"{k} = :{k}")  # noqa: S608
            params[k] = v
    sets.append("updated_at = now()")

    stmt = text(
        f"""
        update platform.devices
        set {", ".join(sets)}
        where id = :id and org_id = :org_id
        returning id, org_id, property_id, device_id, type, capabilities, cert_fingerprint,
                  logical_bindings, last_seen_at, is_offline, offline_since, created_at, updated_at
        """  # noqa: S608
    )
    if "logical_bindings" in params:
        stmt = stmt.bindparams(sa.bindparam("logical_bindings", type_=postgresql.JSONB))
    row = (
        await session.execute(
            stmt,
            params,
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    await session.commit()
    return DeviceRead(**dict(row))


@router.delete("/{device_pk}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device(
    device_pk: uuid.UUID,
    principal: AdminPrincipalDep,
    session: SessionDep,
) -> None:
    result = await session.execute(
        text("delete from platform.devices where id = :id and org_id = :org_id"),
        {"id": str(device_pk), "org_id": str(principal.org_id)},
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    await session.commit()

