import uuid

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from app.auth.dependencies import PrincipalDep
from app.auth.security import hash_password, require_roles
from app.db import SessionDep
from app.models import User, UserRole
from app.modules.admin.users.schemas import UserCreate, UserList, UserRead, UserUpdate

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])
ADMIN_ROLES = {UserRole.IT_ADMIN, UserRole.SERVICE_PROVIDER_ADMIN}


def authorize_admin(principal: PrincipalDep) -> None:
    require_roles(principal, ADMIN_ROLES)


@router.get("", response_model=UserList)
async def list_users(
    principal: PrincipalDep,
    session: SessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    search: str | None = None,
    role: UserRole | None = None,
) -> UserList:
    authorize_admin(principal)
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
async def get_user(user_id: uuid.UUID, principal: PrincipalDep, session: SessionDep) -> UserRead:
    authorize_admin(principal)
    user = await session.scalar(select(User).where(User.id == user_id, User.org_id == principal.org_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return UserRead.model_validate(user)


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate, principal: PrincipalDep, session: SessionDep
) -> UserRead:
    authorize_admin(principal)
    existing = await session.scalar(
        select(User).where(User.org_id == principal.org_id, User.email == payload.email.lower())
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")

    user = User(
        org_id=principal.org_id,
        email=payload.email.lower(),
        full_name=payload.full_name,
        role=payload.role,
        status=payload.status,
        password_hash=hash_password(payload.password),
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return UserRead.model_validate(user)


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: uuid.UUID, payload: UserUpdate, principal: PrincipalDep, session: SessionDep
) -> UserRead:
    authorize_admin(principal)
    user = await session.scalar(select(User).where(User.id == user_id, User.org_id == principal.org_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    data = payload.model_dump(exclude_unset=True)
    if "email" in data and data["email"] is not None:
        data["email"] = data["email"].lower()
    if password := data.pop("password", None):
        user.password_hash = hash_password(password)
    for field, value in data.items():
        setattr(user, field, value)

    await session.commit()
    await session.refresh(user)
    return UserRead.model_validate(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: uuid.UUID, principal: PrincipalDep, session: SessionDep) -> None:
    authorize_admin(principal)
    user = await session.scalar(select(User).where(User.id == user_id, User.org_id == principal.org_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await session.delete(user)
    await session.commit()
