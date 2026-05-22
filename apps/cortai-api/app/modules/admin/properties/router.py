import re
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.auth.dependencies import PrincipalDep, require_roles_dep
from app.db import SessionDep
from app.models import Property, UserRole
from app.modules.admin.properties.schemas import (
    PropertyCreate,
    PropertyList,
    PropertyRead,
    PropertyUpdate,
)

router = APIRouter(prefix="/api/admin/properties", tags=["admin-properties"])
ADMIN_ROLES = {UserRole.IT_ADMIN, UserRole.SERVICE_PROVIDER_ADMIN}
AdminPrincipalDep = Annotated[PrincipalDep, Depends(require_roles_dep(ADMIN_ROLES))]


_slug_cleanup_re = re.compile(r"[^a-z0-9]+")


def _slugify(name: str) -> str:
    s = name.strip().lower()
    s = _slug_cleanup_re.sub("-", s).strip("-")
    return s[:80] or "property"


async def _next_unique_slug(*, session, org_id: uuid.UUID, base: str) -> str:  # type: ignore[no-untyped-def]
    slug = base
    i = 2
    while True:
        existing = await session.scalar(
            select(Property.id).where(Property.org_id == org_id, Property.slug == slug)
        )
        if existing is None:
            return slug
        slug = f"{base[: (80 - len(str(i)) - 1)]}-{i}"
        i += 1


@router.get("", response_model=PropertyList)
async def list_properties(
    principal: AdminPrincipalDep,
    session: SessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    search: str | None = None,
) -> PropertyList:
    filters = [Property.org_id == principal.org_id]
    if search:
        term = f"%{search.lower()}%"
        filters.append(func.lower(Property.name).like(term))

    total = await session.scalar(select(func.count()).select_from(Property).where(*filters))
    result = await session.scalars(
        select(Property)
        .where(*filters)
        .order_by(Property.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return PropertyList(
        items=[PropertyRead.model_validate(p) for p in result.all()],
        total=int(total or 0),
        page=page,
        page_size=page_size,
    )


@router.get("/{property_id}", response_model=PropertyRead)
async def get_property(
    property_id: uuid.UUID, principal: AdminPrincipalDep, session: SessionDep
) -> PropertyRead:
    prop = await session.scalar(
        select(Property).where(Property.id == property_id, Property.org_id == principal.org_id)
    )
    if prop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    return PropertyRead.model_validate(prop)


@router.post("", response_model=PropertyRead, status_code=status.HTTP_201_CREATED)
async def create_property(
    payload: PropertyCreate, principal: AdminPrincipalDep, session: SessionDep
) -> PropertyRead:
    marsha = payload.marsha_property_id.strip() if payload.marsha_property_id else None
    if marsha == "":
        marsha = None
    if marsha is not None:
        existing_marsha = await session.scalar(
            select(Property.id).where(
                Property.org_id == principal.org_id, Property.marsha_property_id == marsha
            )
        )
        if existing_marsha is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="marsha_property_id already exists",
            )

    base = _slugify(payload.name)
    slug = await _next_unique_slug(session=session, org_id=principal.org_id, base=base)
    prop = Property(
        org_id=principal.org_id,
        name=payload.name,
        slug=slug,
        marsha_property_id=marsha,
        address=payload.address,
        room_count=payload.room_count,
        status=payload.status,
    )
    session.add(prop)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Property already exists (conflicting unique field)",
        ) from exc
    await session.refresh(prop)
    return PropertyRead.model_validate(prop)


@router.patch("/{property_id}", response_model=PropertyRead)
async def update_property(
    property_id: uuid.UUID,
    payload: PropertyUpdate,
    principal: AdminPrincipalDep,
    session: SessionDep,
) -> PropertyRead:
    prop = await session.scalar(
        select(Property).where(Property.id == property_id, Property.org_id == principal.org_id)
    )
    if prop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    if "marsha_property_id" in data:
        marsha = data["marsha_property_id"]
        marsha = marsha.strip() if isinstance(marsha, str) else marsha
        if marsha == "":
            marsha = None
        data["marsha_property_id"] = marsha
        if marsha is not None and marsha != prop.marsha_property_id:
            existing_marsha = await session.scalar(
                select(Property.id).where(
                    Property.org_id == principal.org_id,
                    Property.marsha_property_id == marsha,
                    Property.id != prop.id,
                )
            )
            if existing_marsha is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="marsha_property_id already exists",
                )

    for field, value in data.items():
        setattr(prop, field, value)

    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Property update conflicts with an existing record",
        ) from exc
    await session.refresh(prop)
    return PropertyRead.model_validate(prop)


@router.delete("/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_property(
    property_id: uuid.UUID, principal: AdminPrincipalDep, session: SessionDep
) -> None:
    prop = await session.scalar(
        select(Property).where(Property.id == property_id, Property.org_id == principal.org_id)
    )
    if prop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    await session.delete(prop)
    await session.commit()

