from __future__ import annotations

import uuid
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from app.auth.dependencies import PrincipalDep
from app.bridges import iot_client
from app.db import SessionDep
from app.operations.fb_schemas import (
    FbMenuItemCreate,
    FbMenuItemUpdate,
    FbMenuList,
    FbMenuItemRead,
    FbMenuService,
    RoomServiceOrderCreate,
    RoomServiceOrderList,
    RoomServiceOrderRead,
    RoomServiceOrderStatus,
    RoomServiceOrderUpdate,
)

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


@router.get("/room-service", response_model=RoomServiceOrderList)
async def list_room_service_orders(
    principal: PrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID = Query(...),
    status: RoomServiceOrderStatus | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> RoomServiceOrderList:
    # Validate property belongs to org.
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    filters = ["o.org_id = :org_id", "r.property_id = :property_id"]
    params: dict[str, object] = {
        "org_id": str(principal.org_id),
        "property_id": str(property_id),
        "limit": limit,
    }
    if status is not None:
        filters.append("o.status = :status")
        params["status"] = status.value

    where = " and ".join(filters)
    rows = (
        await session.execute(
            text(
                f"""
                select
                  o.id, o.org_id, o.room_id, o.guest_id, o.items_json, o.status,
                  o.created_at, o.updated_at
                from ops.room_service_orders o
                join ops.rooms r on r.id = o.room_id
                where {where}
                order by o.created_at desc, o.id desc
                limit :limit
                """  # noqa: S608
            ),
            params,
        )
    ).mappings().all()
    return RoomServiceOrderList(items=[RoomServiceOrderRead(**dict(r)) for r in rows])


@router.post("/room-service", response_model=RoomServiceOrderRead, status_code=status.HTTP_201_CREATED)
async def create_room_service_order(
    payload: RoomServiceOrderCreate,
    principal: PrincipalDep,
    session: SessionDep,
) -> RoomServiceOrderRead:
    # Validate property belongs to org.
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(payload.property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    # Validate room belongs to that property (and org via RLS).
    room_ok = await session.scalar(
        text(
            """
            select 1
            from ops.rooms
            where id = :room_id and org_id = :org_id and property_id = :property_id
            """
        ),
        {"room_id": str(payload.room_id), "org_id": str(principal.org_id), "property_id": str(payload.property_id)},
    )
    if room_ok is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    st = (payload.status or RoomServiceOrderStatus.RECEIVED).value
    stmt = (
        text(
            """
            insert into ops.room_service_orders (
              id, org_id, room_id, guest_id, items_json, status,
              created_at, updated_at
            )
            values (
              gen_random_uuid(), :org_id, :room_id, :guest_id, :items_json, :status,
              now(), now()
            )
            returning id, org_id, room_id, guest_id, items_json, status, created_at, updated_at
            """
        )
        .bindparams(sa.bindparam("items_json", type_=postgresql.JSONB))
    )
    row = (
        await session.execute(
            stmt,
            {
                "org_id": str(principal.org_id),
                "room_id": str(payload.room_id),
                "guest_id": str(payload.guest_id) if payload.guest_id else None,
                "items_json": jsonable_encoder(payload.items_json),
                "status": st,
            },
        )
    ).mappings().one()
    await session.commit()
    return RoomServiceOrderRead(**dict(row))


@router.patch("/room-service/{order_id}", response_model=RoomServiceOrderRead)
async def update_room_service_order(
    order_id: uuid.UUID,
    payload: RoomServiceOrderUpdate,
    principal: PrincipalDep,
    session: SessionDep,
) -> RoomServiceOrderRead:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    # Load current order (and room/property linkage).
    current = (
        await session.execute(
            text(
                """
                select o.id, o.org_id, o.room_id, r.property_id
                from ops.room_service_orders o
                join ops.rooms r on r.id = o.room_id
                where o.id = :id and o.org_id = :org_id
                """
            ),
            {"id": str(order_id), "org_id": str(principal.org_id)},
        )
    ).mappings().first()
    if current is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room service order not found")

    sets: list[str] = []
    params: dict[str, object] = {"id": str(order_id), "org_id": str(principal.org_id)}

    if "room_id" in data and payload.room_id is not None:
        # Ensure new room is in same property (avoid cross-property moves).
        room_ok = await session.scalar(
            text(
                """
                select 1
                from ops.rooms
                where id = :room_id and org_id = :org_id and property_id = :property_id
                """
            ),
            {
                "room_id": str(payload.room_id),
                "org_id": str(principal.org_id),
                "property_id": str(current["property_id"]),
            },
        )
        if room_ok is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
        sets.append("room_id = :room_id")
        params["room_id"] = str(payload.room_id)

    if "guest_id" in data:
        sets.append("guest_id = :guest_id")
        params["guest_id"] = str(payload.guest_id) if payload.guest_id else None

    if "items_json" in data and payload.items_json is not None:
        sets.append("items_json = :items_json")
        params["items_json"] = jsonable_encoder(payload.items_json)

    if "status" in data and payload.status is not None:
        sets.append("status = :status")
        params["status"] = payload.status.value

    sets.append("updated_at = now()")

    stmt = text(
        f"""
        update ops.room_service_orders
        set {", ".join(sets)}
        where id = :id and org_id = :org_id
        returning id, org_id, room_id, guest_id, items_json, status, created_at, updated_at
        """  # noqa: S608
    )
    if "items_json" in params:
        stmt = stmt.bindparams(sa.bindparam("items_json", type_=postgresql.JSONB))

    row = (await session.execute(stmt, params)).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room service order not found")

    await session.commit()
    return RoomServiceOrderRead(**dict(row))

