from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.bridges import iot_client
from app.db import SessionDep
from app.operations.fitness_schemas import (
    FitnessClassCreate,
    FitnessClassList,
    FitnessClassRead,
    FitnessClassUpdate,
)

router = APIRouter(prefix="/fitness", tags=["operations-fitness"])


@router.get("/capacity")
async def get_fitness_capacity(
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

    return await iot_client.get_fitness_capacity(request)


@router.get("/classes", response_model=FitnessClassList)
async def list_fitness_classes(
    principal: PrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID = Query(...),
) -> FitnessClassList:
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

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
    principal: PrincipalDep,
    session: SessionDep,
) -> FitnessClassRead:
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(payload.property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    if payload.ends_at <= payload.starts_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ends_at must be after starts_at")
    if payload.booked > payload.capacity:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="booked cannot exceed capacity")

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
    principal: PrincipalDep,
    session: SessionDep,
) -> FitnessClassRead:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")

    starts_at = data.get("starts_at", current["starts_at"])
    ends_at = data.get("ends_at", current["ends_at"])
    capacity = int(data.get("capacity", current["capacity"]))
    booked = int(data.get("booked", current["booked"]))

    if ends_at <= starts_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ends_at must be after starts_at")
    if booked > capacity:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="booked cannot exceed capacity")

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")

    await session.commit()
    return FitnessClassRead(**dict(row))

