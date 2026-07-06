import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, model_validator

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
    # Brief calls this field "org"; we accept both for backwards compatibility.
    org: str | None = None
    org_slug: str | None = Field(default=None, validation_alias="org")
    email: EmailStr
    password: str

    @model_validator(mode="after")
    def _require_org(self) -> "LoginRequest":
        if (self.org or "").strip():
            self.org_slug = self.org.strip()
            return self
        if (self.org_slug or "").strip():
            self.org_slug = self.org_slug.strip()
            return self
        raise ValueError("org is required")


class AuthUser(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    email: EmailStr
    full_name: str
    role: UserRole
    status: UserStatus
    password_rotation_due: bool = False


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105
    expires_at: datetime
    user: AuthUser
