import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.models import UserRole, UserStatus


class UserBase(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=180)
    role: UserRole
    status: UserStatus = UserStatus.INVITED


class UserCreate(UserBase):
    password: str = Field(min_length=12, max_length=128)


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, min_length=2, max_length=180)
    role: UserRole | None = None
    status: UserStatus | None = None
    password: str | None = Field(default=None, min_length=12, max_length=128)


class UserRead(UserBase):
    id: uuid.UUID
    org_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class UserList(BaseModel):
    items: list[UserRead]
    total: int
    page: int
    page_size: int
