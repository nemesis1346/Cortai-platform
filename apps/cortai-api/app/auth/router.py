import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select, text
from sqlalchemy.dialects import postgresql

from app.auth.dependencies import PrincipalDep
from app.auth.rate_limit import auth_rate_limit, client_ip
from app.auth.schemas import AuthUser, LoginRequest, TokenResponse
from app.auth.security import create_token, verify_password
from app.config import get_settings
from app.db import SessionDep, SessionLocal, set_current_org
from app.models import Organization, User, UserRole, UserStatus

router = APIRouter(prefix="/api/auth", tags=["auth"])


async def _record_login_event(
    org_id: uuid.UUID,
    *,
    user_id: uuid.UUID | None,
    email: str,
    result: str,
    ip: str | None,
    user_agent: str | None,
) -> None:
    """Write a login success/failure row to audit.change_log. Never raises."""
    try:
        async with SessionLocal() as session:
            await set_current_org(session, str(org_id))
            await session.execute(
                text(
                    "insert into audit.change_log"
                    " (id, org_id, user_id, action, entity_type, entity_id,"
                    "  after_json, ts, ip, user_agent)"
                    " values (:id, :org_id, :user_id, 'post', 'auth_login', :entity_id,"
                    "  :after_json, :ts, :ip, :user_agent)"
                ).bindparams(sa.bindparam("after_json", type_=postgresql.JSONB)),
                {
                    "id": str(uuid.uuid4()),
                    "org_id": str(org_id),
                    "user_id": str(user_id) if user_id else None,
                    "entity_id": str(user_id) if user_id else None,
                    "after_json": {"result": result, "email": email},
                    "ts": datetime.now(UTC),
                    "ip": ip,
                    "user_agent": user_agent,
                },
            )
            await session.commit()
    except Exception:  # noqa: BLE001
        pass


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


@router.post("/login", response_model=TokenResponse, dependencies=[Depends(auth_rate_limit)])
async def login(
    payload: LoginRequest, request: Request, response: Response, session: SessionDep
) -> TokenResponse:
    ip = client_ip(request)
    ua = request.headers.get("user-agent")

    org_slug = payload.org_slug
    organization = await session.scalar(select(Organization).where(Organization.slug == org_slug))
    if organization is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    await set_current_org(session, str(organization.id))

    user = await session.scalar(
        select(User).where(User.org_id == organization.id, User.email == payload.email.lower())
    )
    if user is None or not verify_password(payload.password, user.password_hash):
        await _record_login_event(
            organization.id,
            user_id=None,
            email=payload.email.lower(),
            result="failure",
            ip=ip,
            user_agent=ua,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is not active")

    token_response = create_token(user)
    set_auth_cookie(response, token_response)
    await _record_login_event(
        organization.id,
        user_id=user.id,
        email=user.email,
        result="success",
        ip=ip,
        user_agent=ua,
    )
    return token_response


_ROTATION_DAYS = 180


@router.get("/me", response_model=AuthUser)
async def me(principal: PrincipalDep, session: SessionDep) -> AuthUser:
    user = await session.get(User, principal.user_id)
    if user is None or user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    rotation_due = (
        user.role == UserRole.IT_ADMIN
        and datetime.now(UTC) - user.password_changed_at > timedelta(days=_ROTATION_DAYS)
    )
    return AuthUser(
        id=user.id,
        org_id=user.org_id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        status=user.status,
        password_rotation_due=rotation_due,
    )


@router.post("/refresh", response_model=TokenResponse, dependencies=[Depends(auth_rate_limit)])
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
    settings = get_settings()
    delete_kwargs: dict[str, str] = {"path": "/"}
    if settings.cookie_domain:
        delete_kwargs["domain"] = settings.cookie_domain
    response.delete_cookie("cortai_access_token", **delete_kwargs)
