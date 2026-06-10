from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.bridges import iot_client
from app.db import SessionDep
from app.operations.fb_schemas import FbMenuItemCreate, FbMenuItemUpdate, FbMenuList, FbMenuItemRead, FbMenuService

router = APIRouter(prefix="/fb", tags=["operations-fb"])


@router.get("/breakfast/status")
async def get_breakfast_status(
    request: Request,
    principal: PrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID = Query(...),
) -> Any:
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    return await iot_client.get_fb_breakfast_status(request)


@router.get("/menu", response_model=FbMenuList)
async def list_menu_items(
    principal: PrincipalDep,
    session: SessionDep,
    service: FbMenuService | None = Query(default=None),
    available: bool | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> FbMenuList:
    filters = ["org_id = :org_id"]
    params: dict[str, object] = {"org_id": str(principal.org_id)}
    if service is not None:
        filters.append("service = :service")
        params["service"] = service.value
    if available is not None:
        filters.append("available = :available")
        params["available"] = bool(available)
    where = " and ".join(filters)

    total = await session.scalar(
        text(f"select count(*) from ops.menu_items where {where}"),  # noqa: S608
        params,
    )
    rows = (
        await session.execute(
            text(
                f"""
                select
                  id, org_id, service,
                  name_en, name_fr, price_cents, allergens, available,
                  created_at, updated_at
                from ops.menu_items
                where {where}
                order by service asc, available desc, name_en asc, id asc
                offset :offset limit :limit
                """  # noqa: S608
            ),
            {**params, "offset": (page - 1) * page_size, "limit": page_size},
        )
    ).mappings().all()

    return FbMenuList(
        items=[FbMenuItemRead(**dict(r)) for r in rows],
        total=int(total or 0),
        page=page,
        page_size=page_size,
    )


@router.post("/menu", response_model=FbMenuItemRead, status_code=status.HTTP_201_CREATED)
async def create_menu_item(
    payload: FbMenuItemCreate,
    principal: PrincipalDep,
    session: SessionDep,
) -> FbMenuItemRead:
    row = (
        await session.execute(
            text(
                """
                insert into ops.menu_items (
                  id, org_id, service, name_en, name_fr, price_cents, allergens, available,
                  created_at, updated_at
                )
                values (
                  gen_random_uuid(), :org_id, :service, :name_en, :name_fr, :price_cents, :allergens, :available,
                  now(), now()
                )
                returning
                  id, org_id, service,
                  name_en, name_fr, price_cents, allergens, available,
                  created_at, updated_at
                """
            ),
            {
                "org_id": str(principal.org_id),
                "service": payload.service.value,
                "name_en": payload.name_en,
                "name_fr": payload.name_fr,
                "price_cents": payload.price_cents,
                "allergens": payload.allergens,
                "available": payload.available,
            },
        )
    ).mappings().one()
    await session.commit()
    return FbMenuItemRead(**dict(row))


@router.patch("/menu/{item_id}", response_model=FbMenuItemRead)
async def update_menu_item(
    item_id: uuid.UUID,
    payload: FbMenuItemUpdate,
    principal: PrincipalDep,
    session: SessionDep,
) -> FbMenuItemRead:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    sets: list[str] = []
    params: dict[str, object] = {"id": str(item_id), "org_id": str(principal.org_id)}

    for k, v in data.items():
        if k == "service" and v is not None:
            sets.append("service = :service")
            params["service"] = v.value
        elif k in {"name_en", "name_fr"}:
            sets.append(f"{k} = :{k}")  # noqa: S608
            params[k] = v
        elif k == "price_cents":
            sets.append("price_cents = :price_cents")
            params["price_cents"] = v
        elif k == "allergens":
            sets.append("allergens = :allergens")
            params["allergens"] = v
        elif k == "available":
            sets.append("available = :available")
            params["available"] = bool(v)

    sets.append("updated_at = now()")

    row = (
        await session.execute(
            text(
                f"""
                update ops.menu_items
                set {", ".join(sets)}
                where id = :id and org_id = :org_id
                returning
                  id, org_id, service,
                  name_en, name_fr, price_cents, allergens, available,
                  created_at, updated_at
                """  # noqa: S608
            ),
            params,
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu item not found")

    await session.commit()
    return FbMenuItemRead(**dict(row))

