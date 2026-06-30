from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import text

from app.bridges import iot_client
from app.db import SessionDep
from app.i18n import LocaleDep, http_err
from app.operations.fitness_schemas import (
    FitnessCheckinCreate,
    FitnessCheckinList,
    FitnessCheckinRead,
    FitnessClassCreate,
    FitnessClassList,
    FitnessClassRead,
    FitnessClassUpdate,
)
from app.operations.rbac import OperationsPrincipalDep

router = APIRouter(prefix="/fitness", tags=["operations-fitness"])


@router.get("/capacity")
async def get_fitness_capacity(
    request: Request,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
    property_id: uuid.UUID = Query(...),
) -> Any:
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.common.property_not_found", locale))

    return await iot_client.get_fitness_capacity(request)


@router.get("/equipment")
async def get_fitness_equipment(
    request: Request,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
    property_id: uuid.UUID = Query(...),
) -> Any:
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.common.property_not_found", locale))

    return await iot_client.get_fitness_equipment(request)


@router.get("/classes", response_model=FitnessClassList)
async def list_fitness_classes(
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
    property_id: uuid.UUID = Query(...),
) -> FitnessClassList:
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.common.property_not_found", locale))

    rows = (
        await session.execute(
            text(
                """
                select
                  id, org_id, property_id,
                  name, instructor_name,
                  starts_at, ends_at,
                  capacity, booked,
                  location, description,
                  status,
                  created_at, updated_at
                from ops.fitness_classes
                where org_id = :org_id and property_id = :property_id
                order by starts_at asc, id asc
                """
            ),
            {"org_id": str(principal.org_id), "property_id": str(property_id)},
        )
    ).mappings().all()
    return FitnessClassList(items=[FitnessClassRead(**dict(r)) for r in rows])


@router.post("/classes", response_model=FitnessClassRead, status_code=status.HTTP_201_CREATED)
async def create_fitness_class(
    payload: FitnessClassCreate,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
) -> FitnessClassRead:
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(payload.property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.common.property_not_found", locale))
    if payload.ends_at <= payload.starts_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=http_err("operations.meetings.ends_before_starts", locale))
    if payload.booked > payload.capacity:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=http_err("operations.fitness.booked_exceeds_capacity", locale))

    now = datetime.now(UTC)
    row = (
        await session.execute(
            text(
                """
                insert into ops.fitness_classes (
                  id, org_id, property_id,
                  name, instructor_name,
                  starts_at, ends_at,
                  capacity, booked,
                  location, description,
                  status,
                  created_at, updated_at
                )
                values (
                  gen_random_uuid(), :org_id, :property_id,
                  :name, :instructor_name,
                  :starts_at, :ends_at,
                  :capacity, :booked,
                  :location, :description,
                  :status,
                  :now, :now
                )
                returning
                  id, org_id, property_id,
                  name, instructor_name,
                  starts_at, ends_at,
                  capacity, booked,
                  location, description,
                  status,
                  created_at, updated_at
                """
            ),
            {
                "org_id": str(principal.org_id),
                "property_id": str(payload.property_id),
                "name": payload.name,
                "instructor_name": payload.instructor_name,
                "starts_at": payload.starts_at,
                "ends_at": payload.ends_at,
                "capacity": payload.capacity,
                "booked": payload.booked,
                "location": payload.location,
                "description": payload.description,
                "status": payload.status,
                "now": now,
            },
        )
    ).mappings().one()
    await session.commit()
    return FitnessClassRead(**dict(row))


@router.patch("/classes/{class_id}", response_model=FitnessClassRead)
async def update_fitness_class(
    class_id: uuid.UUID,
    payload: FitnessClassUpdate,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
) -> FitnessClassRead:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=http_err("operations.common.no_fields_to_update", locale))

    # Ensure class exists for org (and load property_id if needed later).
    current = (
        await session.execute(
            text(
                """
                select id, org_id, property_id, starts_at, ends_at, capacity, booked
                from ops.fitness_classes
                where id = :id and org_id = :org_id
                """
            ),
            {"id": str(class_id), "org_id": str(principal.org_id)},
        )
    ).mappings().first()
    if current is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.fitness.class_not_found", locale))

    starts_at = data.get("starts_at", current["starts_at"])
    ends_at = data.get("ends_at", current["ends_at"])
    capacity = int(data.get("capacity", current["capacity"]))
    booked = int(data.get("booked", current["booked"]))

    if ends_at <= starts_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=http_err("operations.meetings.ends_before_starts", locale))
    if booked > capacity:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=http_err("operations.fitness.booked_exceeds_capacity", locale))

    sets: list[str] = []
    params: dict[str, object] = {"id": str(class_id), "org_id": str(principal.org_id)}
    for k, v in data.items():
        sets.append(f"{k} = :{k}")  # noqa: S608
        params[k] = str(v) if isinstance(v, uuid.UUID) else v
    sets.append("updated_at = now()")

    row = (
        await session.execute(
            text(
                f"""
                update ops.fitness_classes
                set {", ".join(sets)}
                where id = :id and org_id = :org_id
                returning
                  id, org_id, property_id,
                  name, instructor_name,
                  starts_at, ends_at,
                  capacity, booked,
                  location, description,
                  status,
                  created_at, updated_at
                """  # noqa: S608
            ),
            params,
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.fitness.class_not_found", locale))

    await session.commit()
    return FitnessClassRead(**dict(row))


@router.get("/checkins", response_model=FitnessCheckinList)
async def list_fitness_checkins(
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
    property_id: uuid.UUID = Query(...),
    guest_id: uuid.UUID | None = Query(default=None),
) -> FitnessCheckinList:
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.common.property_not_found", locale))

    where = ["org_id = :org_id", "property_id = :property_id"]
    params: dict[str, object] = {"org_id": str(principal.org_id), "property_id": str(property_id)}
    if guest_id is not None:
        where.append("guest_id = :guest_id")
        params["guest_id"] = str(guest_id)

    rows = (
        await session.execute(
            text(
                f"""
                select
                  id, org_id, property_id, guest_id, class_id,
                  checked_in_at, source, notes,
                  created_at, updated_at
                from ops.fitness_checkins
                where {" and ".join(where)}
                order by checked_in_at desc, id desc
                """  # noqa: S608
            ),
            params,
        )
    ).mappings().all()
    return FitnessCheckinList(items=[FitnessCheckinRead(**dict(r)) for r in rows])


@router.post("/checkins", response_model=FitnessCheckinRead, status_code=status.HTTP_201_CREATED)
async def create_fitness_checkin(
    payload: FitnessCheckinCreate,
    principal: OperationsPrincipalDep,
    session: SessionDep,
    locale: LocaleDep,
) -> FitnessCheckinRead:
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(payload.property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.common.property_not_found", locale))

    guest_ok = await session.scalar(
        text("select 1 from ops.guests where id = :id and org_id = :org_id"),
        {"id": str(payload.guest_id), "org_id": str(principal.org_id)},
    )
    if guest_ok is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.common.guest_not_found", locale))

    if payload.class_id is not None:
        class_ok = await session.scalar(
            text(
                """
                select 1
                from ops.fitness_classes
                where id = :id and org_id = :org_id and property_id = :property_id
                """
            ),
            {
                "id": str(payload.class_id),
                "org_id": str(principal.org_id),
                "property_id": str(payload.property_id),
            },
        )
        if class_ok is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=http_err("operations.fitness.class_not_found", locale))

    checked_in_at = payload.checked_in_at or datetime.now(UTC)

    row = (
        await session.execute(
            text(
                """
                insert into ops.fitness_checkins (
                  id, org_id, property_id, guest_id, class_id,
                  checked_in_at, source, notes,
                  created_at, updated_at
                )
                values (
                  gen_random_uuid(), :org_id, :property_id, :guest_id, :class_id,
                  :checked_in_at, :source, :notes,
                  now(), now()
                )
                returning
                  id, org_id, property_id, guest_id, class_id,
                  checked_in_at, source, notes,
                  created_at, updated_at
                """
            ),
            {
                "org_id": str(principal.org_id),
                "property_id": str(payload.property_id),
                "guest_id": str(payload.guest_id),
                "class_id": str(payload.class_id) if payload.class_id else None,
                "checked_in_at": checked_in_at,
                "source": payload.source,
                "notes": payload.notes,
            },
        )
    ).mappings().one()
    await session.commit()
    return FitnessCheckinRead(**dict(row))

