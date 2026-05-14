from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select

from app.auth.dependencies import PrincipalDep
from app.auth.schemas import AuthUser, LoginRequest, TokenResponse
from app.auth.security import create_token, verify_password
from app.config import get_settings
from app.db import SessionDep, set_current_org
from app.models import Organization, User, UserStatus

router = APIRouter(prefix="/api/auth", tags=["auth"])


def set_auth_cookie(response: Response, token_response: TokenResponse) -> None:
    settings = get_settings()
    response.set_cookie(
        key="cortai_access_token",
        value=token_response.access_token,
        httponly=True,
        secure=settings.environment != "local",
        samesite="lax",
        max_age=settings.jwt_ttl_seconds,
        path="/",
        domain=settings.cookie_domain,
    )


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, response: Response, session: SessionDep) -> TokenResponse:
    org_slug = payload.org_slug
    organization = await session.scalar(select(Organization).where(Organization.slug == org_slug))
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
    set_auth_cookie(response, token_response)
    return token_response


@router.get("/me", response_model=AuthUser)
async def me(principal: PrincipalDep, session: SessionDep) -> AuthUser:
    user = await session.get(User, principal.user_id)
    if user is None or user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    return AuthUser(
        id=user.id,
        org_id=user.org_id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        status=user.status,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    principal: PrincipalDep, response: Response, session: SessionDep
) -> TokenResponse:
    user = await session.get(User, principal.user_id)
    if user is None or user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    token_response = create_token(user)
    set_auth_cookie(response, token_response)
    return token_response


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> None:
    response.delete_cookie("cortai_access_token", path="/")
