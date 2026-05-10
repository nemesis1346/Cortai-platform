from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select

from app.auth.dependencies import PrincipalDep
from app.auth.schemas import LoginRequest, TokenResponse
from app.auth.security import create_token, verify_password
from app.config import get_settings
from app.db import SessionDep, set_current_org
from app.models import Organization, User, UserStatus

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, response: Response, session: SessionDep) -> TokenResponse:
    organization = await session.scalar(select(Organization).where(Organization.slug == payload.org_slug))
    if organization is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    await set_current_org(session, str(organization.id))

    user = await session.scalar(
        select(User).where(User.org_id == organization.id, User.email == payload.email.lower())
    )
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is not active")

    token_response = create_token(user)
    settings = get_settings()
    cookie_kwargs: dict[str, object] = {
        "key": "cortai_access_token",
        "value": token_response.access_token,
        "httponly": True,
        "secure": settings.environment != "local",
        "samesite": "lax",
        "max_age": settings.jwt_ttl_seconds,
        "path": "/",
    }
    if settings.cookie_domain is not None:
        cookie_kwargs["domain"] = settings.cookie_domain
    response.set_cookie(
        **cookie_kwargs,
    )
    return token_response


@router.post("/refresh", response_model=TokenResponse)
async def refresh(principal: PrincipalDep, response: Response, session: SessionDep) -> TokenResponse:
    user = await session.get(User, principal.user_id)
    if user is None or user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    token_response = create_token(user)
    settings = get_settings()
    cookie_kwargs: dict[str, object] = {
        "key": "cortai_access_token",
        "value": token_response.access_token,
        "httponly": True,
        "secure": settings.environment != "local",
        "samesite": "lax",
        "max_age": settings.jwt_ttl_seconds,
        "path": "/",
    }
    if settings.cookie_domain is not None:
        cookie_kwargs["domain"] = settings.cookie_domain
    response.set_cookie(
        **cookie_kwargs,
    )
    return token_response


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> None:
    response.delete_cookie("cortai_access_token", path="/")
