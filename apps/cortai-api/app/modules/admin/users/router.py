import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select

from app.auth.dependencies import PrincipalDep, require_roles_dep
from app.auth.password_policy import CURRENT_POLICY_VERSION, validate_password
from app.auth.security import hash_password
from app.db import SessionDep
from app.models import User, UserRole
from app.modules.admin.users.schemas import UserCreate, UserList, UserRead, UserUpdate

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])
ADMIN_ROLES = {UserRole.IT_ADMIN, UserRole.SERVICE_PROVIDER_ADMIN}
AdminPrincipalDep = Annotated[PrincipalDep, Depends(require_roles_dep(ADMIN_ROLES))]


@router.get("", response_model=UserList)
async def list_users(
    principal: AdminPrincipalDep,
    session: SessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    search: str | None = None,
    role: UserRole | None = None,
) -> UserList:
    filters = [User.org_id == principal.org_id]
    if search:
        term = f"%{search.lower()}%"
        filters.append(func.lower(User.email).like(term) | func.lower(User.full_name).like(term))
    if role:
        filters.append(User.role == role)

    total = await session.scalar(select(func.count()).select_from(User).where(*filters))
    result = await session.scalars(
        select(User)
        .where(*filters)
        .order_by(User.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return UserList(
        items=[UserRead.model_validate(user) for user in result.all()],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


@router.get("/{user_id}", response_model=UserRead)
async def get_user(
    user_id: uuid.UUID, principal: AdminPrincipalDep, session: SessionDep
) -> UserRead:
    user = await session.scalar(
        select(User).where(User.id == user_id, User.org_id == principal.org_id)
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return UserRead.model_validate(user)


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate, principal: AdminPrincipalDep, session: SessionDep
) -> UserRead:
    existing = await session.scalar(
        select(User).where(User.org_id == principal.org_id, User.email == payload.email.lower())
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")

    validate_password(payload.password)
    now = datetime.now(UTC)
    user = User(
        org_id=principal.org_id,
        email=payload.email.lower(),
        full_name=payload.full_name,
        role=payload.role,
        status=payload.status,
        password_hash=hash_password(payload.password),
        password_policy_version=CURRENT_POLICY_VERSION,
        password_changed_at=now,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return UserRead.model_validate(user)


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: uuid.UUID, payload: UserUpdate, principal: AdminPrincipalDep, session: SessionDep
) -> UserRead:
    user = await session.scalar(
        select(User).where(User.id == user_id, User.org_id == principal.org_id)
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    data = payload.model_dump(exclude_unset=True)
    if "email" in data and data["email"] is not None:
        data["email"] = data["email"].lower()
    if password := data.pop("password", None):
        validate_password(password)
        user.password_hash = hash_password(password)
        user.password_changed_at = datetime.now(UTC)
        user.password_policy_version = CURRENT_POLICY_VERSION
    for field, value in data.items():
        setattr(user, field, value)

    await session.commit()
    await session.refresh(user)
    return UserRead.model_validate(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID, principal: AdminPrincipalDep, session: SessionDep
) -> None:
    user = await session.scalar(
        select(User).where(User.id == user_id, User.org_id == principal.org_id)
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await session.delete(user)
    await session.commit()
