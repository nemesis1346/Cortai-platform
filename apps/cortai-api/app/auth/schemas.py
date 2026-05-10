import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr

from app.models import UserRole, UserStatus


class TokenClaims(BaseModel):
    sub: str
    org_id: str
    role: UserRole
    email: EmailStr
    exp: int
    iat: int
    iss: str
    aud: str


class Principal(BaseModel):
    user_id: uuid.UUID
    org_id: uuid.UUID
    email: EmailStr
    role: UserRole


class LoginRequest(BaseModel):
    org_slug: str
    email: EmailStr
    password: str


class AuthUser(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    email: EmailStr
    full_name: str
    role: UserRole
    status: UserStatus


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: AuthUser
