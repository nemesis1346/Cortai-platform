from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock

from fastapi import HTTPException
from fastapi.testclient import TestClient
from test_admin_users import ADMIN_ID, ORG_A, FakeSession

from app.auth.dependencies import get_principal
from app.auth.router import logout, set_auth_cookie
from app.auth.schemas import Principal, TokenResponse
from app.auth.security import (
    create_token,
    hash_password,
    require_roles,
    token_from_request,
    verify_password,
)
from app.db import get_session
from app.main import create_app
from app.models import User, UserRole, UserStatus


class AuthSession(FakeSession):
    async def get(self, model: type[User], user_id: object) -> User | None:
        if model is User and user_id == ADMIN_ID:
            return self.users[0]
        return None


def test_me_returns_current_user() -> None:
    app = create_app()
    fake_session = AuthSession()

    async def override_session() -> AuthSession:
        return fake_session

    async def override_principal() -> Principal:
        return Principal(
            user_id=ADMIN_ID,
            org_id=ORG_A,
            email="admin@hotel-a.example.com",
            role=UserRole.IT_ADMIN,
        )

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_principal] = override_principal
    response = TestClient(app).get("/api/auth/me")

    assert response.status_code == 200
    assert response.json()["email"] == "admin@hotel-a.example.com"


def test_refresh_reissues_cookie(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    app = create_app()
    fake_session = AuthSession()
    test_token = "refreshed-token"  # noqa: S105

    async def override_session() -> AuthSession:
        return fake_session

    async def override_principal() -> Principal:
        return Principal(
            user_id=ADMIN_ID,
            org_id=ORG_A,
            email="admin@hotel-a.example.com",
            role=UserRole.IT_ADMIN,
        )

    def fake_create_token(user: User) -> TokenResponse:
        return TokenResponse(
            access_token=test_token,
            expires_at=datetime.now(UTC),
            user={
                "id": user.id,
                "org_id": user.org_id,
                "email": user.email,
                "full_name": user.full_name,
                "role": user.role,
                "status": user.status,
            },
        )

    monkeypatch.setattr("app.auth.router.create_token", fake_create_token)
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_principal] = override_principal
    response = TestClient(app).post("/api/auth/refresh")

    assert response.status_code == 200
    assert response.json()["access_token"] == test_token
    assert f"cortai_access_token={test_token}" in response.headers["set-cookie"]


def test_security_helpers_cover_error_paths() -> None:
    request = AsyncMock()
    request.headers = {"authorization": "Bearer header-token"}
    request.cookies = {"cortai_access_token": "cookie-token"}

    assert token_from_request(request) == "header-token"

    try:
        require_roles(
            Principal(
                user_id=ADMIN_ID,
                org_id=ORG_A,
                email="staff@hotel-a.example.com",
                role=UserRole.STAFF,
            ),
            {UserRole.IT_ADMIN},
        )
    except HTTPException as exc:
        assert exc.status_code == 403
    else:  # pragma: no cover
        raise AssertionError("Expected HTTPException")


def test_password_hash_and_token_creation(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    password_hash = hash_password("very-secure-password")
    assert verify_password("very-secure-password", password_hash)
    test_token = "signed-token"  # noqa: S105

    monkeypatch.setattr("app.auth.security._private_key", lambda: "private-key")
    monkeypatch.setattr("app.auth.security.jwt.encode", lambda *_args, **_kwargs: test_token)
    user = AuthSession().users[0]

    token_response = create_token(user)

    assert token_response.access_token == test_token
    assert token_response.user.email == user.email


async def test_cookie_helpers() -> None:
    response = Mock()
    test_token = "cookie-token"  # noqa: S105
    token_response = TokenResponse(
        access_token=test_token,
        expires_at=datetime.now(UTC),
        user={
            "id": ADMIN_ID,
            "org_id": ORG_A,
            "email": "admin@hotel-a.example.com",
            "full_name": "Admin",
            "role": UserRole.IT_ADMIN,
            "status": UserStatus.ACTIVE,
        },
    )

    set_auth_cookie(response, token_response)
    response.set_cookie.assert_called_once()

    await logout(response)
    response.delete_cookie.assert_called_once_with("cortai_access_token", path="/")
