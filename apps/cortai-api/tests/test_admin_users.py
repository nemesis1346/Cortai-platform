import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.auth.dependencies import get_principal
from app.auth.schemas import Principal
from app.db import get_session
from app.main import create_app
from app.models import User, UserRole, UserStatus

ORG_A = uuid.uuid4()
ORG_B = uuid.uuid4()
ADMIN_ID = uuid.uuid4()


class FakeScalars:
    def __init__(self, items: list[User]) -> None:
        self._items = items

    def all(self) -> list[User]:
        return self._items


class FakeSession:
    def __init__(self) -> None:
        self.users: list[User] = [
            self.make_user(org_id=ORG_A, email="admin@hotel-a.example.com"),
            self.make_user(org_id=ORG_B, email="admin@hotel-b.example.com"),
        ]
        self.committed = False

    @staticmethod
    def make_user(org_id: uuid.UUID, email: str) -> User:
        now = datetime.now(UTC)
        user = User(
            id=uuid.uuid4(),
            org_id=org_id,
            email=email,
            full_name=email.split("@")[0],
            role=UserRole.IT_ADMIN,
            status=UserStatus.ACTIVE,
            password_hash="hash",  # noqa: S106
            created_at=now,
            updated_at=now,
        )
        return user

    async def scalar(self, statement: object) -> int | User | None:
        query = str(statement)
        if "count" in query:
            return len([user for user in self.users if user.org_id == ORG_A])
        if "WHERE users.id" in query:
            return next((user for user in self.users if user.org_id == ORG_A), None)
        if "users.email" in query:
            return None
        return None

    async def scalars(self, statement: object) -> FakeScalars:
        return FakeScalars([user for user in self.users if user.org_id == ORG_A])

    def add(self, user: User) -> None:
        self.users.append(user)

    async def commit(self) -> None:
        self.committed = True

    async def refresh(self, user: User) -> None:
        if user.id is None:
            user.id = uuid.uuid4()
        now = datetime.now(UTC)
        if user.created_at is None:
            user.created_at = now
        if user.updated_at is None:
            user.updated_at = now

    async def delete(self, user: User) -> None:
        self.users.remove(user)


@pytest.fixture
def client() -> TestClient:
    app = create_app()
    fake_session = FakeSession()

    async def override_session() -> FakeSession:
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
    return TestClient(app)


def test_list_users_is_scoped_to_principal_org(client: TestClient) -> None:
    response = client.get("/api/admin/users")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert all(item["org_id"] == str(ORG_A) for item in body["items"])


def test_create_user_uses_principal_org(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.modules.admin.users.router.hash_password", lambda password: "hashed")
    response = client.post(
        "/api/admin/users",
        json={
            "email": "new.user@hotel-a.example.com",
            "full_name": "New User",
            "role": "HOTEL_ADMIN",
            "status": "ACTIVE",
            "password": "very-secure-password",
        },
    )

    assert response.status_code == 201
    assert response.json()["org_id"] == str(ORG_A)
    assert response.json()["email"] == "new.user@hotel-a.example.com"


def test_non_admin_is_forbidden() -> None:
    app = create_app()

    async def override_session() -> AsyncMock:
        return AsyncMock()

    async def override_principal() -> Principal:
        return Principal(
            user_id=ADMIN_ID,
            org_id=ORG_A,
            email="staff@hotel-a.example.com",
            role=UserRole.STAFF,
        )

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_principal] = override_principal
    response = TestClient(app).get("/api/admin/users")

    assert response.status_code == 403


def test_get_user_returns_same_org_user(client: TestClient) -> None:
    response = client.get(f"/api/admin/users/{uuid.uuid4()}")

    assert response.status_code == 200
    assert response.json()["org_id"] == str(ORG_A)


def test_update_user_changes_same_org_user(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.modules.admin.users.router.hash_password", lambda password: "updated")
    response = client.patch(
        f"/api/admin/users/{uuid.uuid4()}",
        json={"full_name": "Updated Admin", "password": "new-secure-password"},
    )

    assert response.status_code == 200
    assert response.json()["full_name"] == "Updated Admin"
    assert response.json()["org_id"] == str(ORG_A)


def test_delete_user_removes_same_org_user(client: TestClient) -> None:
    response = client.delete(f"/api/admin/users/{uuid.uuid4()}")

    assert response.status_code == 204
