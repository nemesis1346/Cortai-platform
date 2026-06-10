from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep
from app.operations.spa_schemas import (
    SpaAppointmentCreate,
    SpaAppointmentList,
    SpaAppointmentRead,
    SpaAppointmentUpdate,
)

router = APIRouter(prefix="/spa", tags=["operations-spa"])


@router.get("/appointments", response_model=SpaAppointmentList)
async def list_spa_appointments(
    principal: PrincipalDep,
    session: SessionDep,
    property_id: uuid.UUID = Query(...),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> SpaAppointmentList:
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    total = await session.scalar(
        text(
            """
            select count(*)
            from ops.spa_appointments
            where org_id = :org_id and property_id = :property_id
            """
        ),
        {"org_id": str(principal.org_id), "property_id": str(property_id)},
    )

    rows = (
        await session.execute(
            text(
                """
                select
                  id, org_id, property_id, guest_id, service, therapist_user_id,
                  starts_at, ends_at, status,
                  created_at, updated_at
                from ops.spa_appointments
                where org_id = :org_id and property_id = :property_id
                order by starts_at desc, id desc
                offset :offset limit :limit
                """
            ),
            {
                "org_id": str(principal.org_id),
                "property_id": str(property_id),
                "offset": (page - 1) * page_size,
                "limit": page_size,
            },
        )
    ).mappings().all()

    return SpaAppointmentList(
        items=[SpaAppointmentRead(**dict(r)) for r in rows],
        total=int(total or 0),
        page=page,
        page_size=page_size,
    )


@router.post("/appointments", response_model=SpaAppointmentRead, status_code=status.HTTP_201_CREATED)
async def create_spa_appointment(
    payload: SpaAppointmentCreate,
    principal: PrincipalDep,
    session: SessionDep,
) -> SpaAppointmentRead:
    # Validate property belongs to org.
    exists = await session.scalar(
        text("select 1 from properties where id = :id and org_id = :org_id"),
        {"id": str(payload.property_id), "org_id": str(principal.org_id)},
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    # Validate guest exists in org (avoid FK 500s).
    guest_ok = await session.scalar(
        text("select 1 from ops.guests where id = :id and org_id = :org_id"),
        {"id": str(payload.guest_id), "org_id": str(principal.org_id)},
    )
    if guest_ok is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Guest not found")

    if payload.therapist_user_id is not None:
        user_ok = await session.scalar(
            text("select 1 from users where id = :id and org_id = :org_id"),
            {"id": str(payload.therapist_user_id), "org_id": str(principal.org_id)},
        )
        if user_ok is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Therapist user not found")

    now = datetime.now(UTC)
    row = (
        await session.execute(
            text(
                """
                insert into ops.spa_appointments (
                  id, org_id, property_id, guest_id, service, therapist_user_id,
                  starts_at, ends_at, status,
                  created_at, updated_at
                )
                values (
                  gen_random_uuid(), :org_id, :property_id, :guest_id, :service, :therapist_user_id,
                  :starts_at, :ends_at, :status,
                  :now, :now
                )
                returning
                  id, org_id, property_id, guest_id, service, therapist_user_id,
                  starts_at, ends_at, status,
                  created_at, updated_at
                """
            ),
            {
                "org_id": str(principal.org_id),
                "property_id": str(payload.property_id),
                "guest_id": str(payload.guest_id),
                "service": payload.service,
                "therapist_user_id": str(payload.therapist_user_id) if payload.therapist_user_id else None,
                "starts_at": payload.starts_at,
                "ends_at": payload.ends_at,
                "status": payload.status,
                "now": now,
            },
        )
    ).mappings().one()
    await session.commit()
    return SpaAppointmentRead(**dict(row))


@router.patch("/appointments/{appointment_id}", response_model=SpaAppointmentRead)
async def update_spa_appointment(
    appointment_id: uuid.UUID,
    payload: SpaAppointmentUpdate,
    principal: PrincipalDep,
    session: SessionDep,
) -> SpaAppointmentRead:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    # Load current (for property scope + existence).
    current = (
        await session.execute(
            text(
                """
                select id, org_id, property_id
                from ops.spa_appointments
                where id = :id and org_id = :org_id
                """
            ),
            {"id": str(appointment_id), "org_id": str(principal.org_id)},
        )
    ).mappings().first()
    if current is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Appointment not found")

    if payload.guest_id is not None:
        guest_ok = await session.scalar(
            text("select 1 from ops.guests where id = :id and org_id = :org_id"),
            {"id": str(payload.guest_id), "org_id": str(principal.org_id)},
        )
        if guest_ok is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Guest not found")

    if "therapist_user_id" in data and payload.therapist_user_id is not None:
        user_ok = await session.scalar(
            text("select 1 from users where id = :id and org_id = :org_id"),
            {"id": str(payload.therapist_user_id), "org_id": str(principal.org_id)},
        )
        if user_ok is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Therapist user not found")

    sets: list[str] = []
    params: dict[str, object] = {"id": str(appointment_id), "org_id": str(principal.org_id)}
    for k, v in data.items():
        sets.append(f"{k} = :{k}")  # noqa: S608
        params[k] = str(v) if isinstance(v, uuid.UUID) else v
    sets.append("updated_at = now()")

    row = (
        await session.execute(
            text(
                f"""
                update ops.spa_appointments
                set {", ".join(sets)}
                where id = :id and org_id = :org_id
                returning
                  id, org_id, property_id, guest_id, service, therapist_user_id,
                  starts_at, ends_at, status,
                  created_at, updated_at
                """  # noqa: S608
            ),
            params,
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Appointment not found")

    await session.commit()
    return SpaAppointmentRead(**dict(row))

