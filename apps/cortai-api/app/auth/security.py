import uuid
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt
from fastapi import HTTPException, Request, status

from app.auth.schemas import AuthUser, Principal, TokenClaims, TokenResponse
from app.config import get_settings
from app.models import User, UserRole


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def _private_key() -> str:
    settings = get_settings()
    if not settings.jwt_private_key:
        raise RuntimeError("JWT_PRIVATE_KEY is required for token signing")
    return settings.jwt_private_key.replace("\\n", "\n")


def _public_key() -> str:
    settings = get_settings()
    if not settings.jwt_public_key:
        raise RuntimeError("JWT_PUBLIC_KEY is required for token verification")
    return settings.jwt_public_key.replace("\\n", "\n")


def create_token(user: User) -> TokenResponse:
    settings = get_settings()
    now = datetime.now(UTC)
    expires_at = now + timedelta(seconds=settings.jwt_ttl_seconds)
    payload = {
        "sub": str(user.id),
        "org_id": str(user.org_id),
        "email": user.email,
        "role": user.role.value,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    token = jwt.encode(payload, _private_key(), algorithm="RS256")
    auth_user = AuthUser(
        id=user.id,
        org_id=user.org_id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        status=user.status,
    )
    return TokenResponse(access_token=token, expires_at=expires_at, user=auth_user)


def decode_token(token: str) -> Principal:
    settings = get_settings()
    try:
        claims = TokenClaims.model_validate(
            jwt.decode(
                token,
                _public_key(),
                algorithms=["RS256"],
                audience=settings.jwt_audience,
                issuer=settings.jwt_issuer,
            )
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    return Principal(
        user_id=uuid.UUID(claims.sub),
        org_id=uuid.UUID(claims.org_id),
        email=claims.email,
        role=claims.role,
    )


def token_from_request(request: Request) -> str | None:
    authorization = request.headers.get("authorization")
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1]
    cookie_token = request.cookies.get("cortai_access_token")
    return cookie_token


def require_roles(principal: Principal, allowed_roles: set[UserRole]) -> None:
    if principal.role not in allowed_roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
