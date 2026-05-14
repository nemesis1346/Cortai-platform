import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.auth.dependencies import get_principal
from app.auth.schemas import Principal
from app.db import SessionLocal, get_session, set_current_org
from app.main import create_app
from app.models import Organization, User, UserRole, UserStatus


@pytest_asyncio.fixture
async def seeded_admin_users() -> dict[str, uuid.UUID | str]:
    """
    Integration test seed data for admin users endpoints.

    Uses two organizations and multiple users and cleans them up afterwards.
    RLS is enabled/forced on `users`, so writes/deletes must set `app.current_org_id`.
    """

    org_a = uuid.uuid4()
    org_b = uuid.uuid4()
    now = datetime.now(UTC)

    admin_id = uuid.uuid4()
    user_a2_id = uuid.uuid4()
    user_b_id = uuid.uuid4()

    email_admin_a = f"admin-{org_a}@hotel-a.example.com"
    email_user_a2 = f"user-{org_a}@hotel-a.example.com"
    email_admin_b = f"admin-{org_b}@hotel-b.example.com"

    async with SessionLocal() as session:
        session.add_all(
            [
                Organization(id=org_a, name="Admin Users Org A", slug=f"admin-users-a-{org_a}"),
                Organization(id=org_b, name="Admin Users Org B", slug=f"admin-users-b-{org_b}"),
            ]
        )
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_a))
        session.add_all(
            [
                User(
                    id=admin_id,
                    org_id=org_a,
                    email=email_admin_a,
                    full_name="Org A Admin",
                    role=UserRole.IT_ADMIN,
                    status=UserStatus.ACTIVE,
                    password_hash="hash",  # noqa: S106
                    created_at=now,
                    updated_at=now,
                ),
                User(
                    id=user_a2_id,
                    org_id=org_a,
                    email=email_user_a2,
                    full_name="Org A Second User",
                    role=UserRole.HOTEL_ADMIN,
                    status=UserStatus.ACTIVE,
                    password_hash="hash",  # noqa: S106
                    created_at=now,
                    updated_at=now,
                ),
            ]
        )
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_b))
        session.add(
            User(
                id=user_b_id,
                org_id=org_b,
                email=email_admin_b,
                full_name="Org B Admin",
                role=UserRole.IT_ADMIN,
                status=UserStatus.ACTIVE,
                password_hash="hash",  # noqa: S106
                created_at=now,
                updated_at=now,
            )
        )
        await session.commit()

    yield {
        "org_a": org_a,
        "org_b": org_b,
        "admin_id": admin_id,
        "user_a2_id": user_a2_id,
        "user_b_id": user_b_id,
        "email_admin_a": email_admin_a,
        "email_user_a2": email_user_a2,
        "email_admin_b": email_admin_b,
    }

    async with SessionLocal() as session:
        await set_current_org(session, str(org_a))
        await session.execute(text("delete from users where org_id = :org_id"), {"org_id": org_a})
        await set_current_org(session, str(org_b))
        await session.execute(text("delete from users where org_id = :org_id"), {"org_id": org_b})
        await session.execute(
            text("delete from organizations where id in (:org_a, :org_b)"),
            {"org_a": org_a, "org_b": org_b},
        )
        await session.commit()


def _client_for_org(
    *, org_id: uuid.UUID, user_id: uuid.UUID, role: UserRole, email: str
) -> AsyncClient:
    app = create_app()

    async def override_principal() -> Principal:
        return Principal(user_id=user_id, org_id=org_id, email=email, role=role)

    async def override_session():  # type: ignore[no-untyped-def]
        async with SessionLocal() as session:
            await set_current_org(session, str(org_id))
            yield session

    app.dependency_overrides[get_principal] = override_principal
    app.dependency_overrides[get_session] = override_session

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_list_users_is_scoped_to_principal_org(seeded_admin_users) -> None:  # type: ignore[no-untyped-def]
    org_a = seeded_admin_users["org_a"]
    admin_id = seeded_admin_users["admin_id"]
    email_admin_a = seeded_admin_users["email_admin_a"]

    async with _client_for_org(
        org_id=org_a, user_id=admin_id, role=UserRole.IT_ADMIN, email=str(email_admin_a)
    ) as client:
        response = await client.get("/api/admin/users")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert all(item["org_id"] == str(org_a) for item in body["items"])


@pytest.mark.asyncio
async def test_create_user_uses_principal_org(
    seeded_admin_users, monkeypatch: pytest.MonkeyPatch
) -> None:  # type: ignore[no-untyped-def]
    org_a = seeded_admin_users["org_a"]
    admin_id = seeded_admin_users["admin_id"]
    email_admin_a = seeded_admin_users["email_admin_a"]
    monkeypatch.setattr("app.modules.admin.users.router.hash_password", lambda _password: "hashed")
    new_email = f"new.user-{uuid.uuid4()}@hotel-a.example.com"

    async with _client_for_org(
        org_id=org_a, user_id=admin_id, role=UserRole.IT_ADMIN, email=str(email_admin_a)
    ) as client:
        response = await client.post(
            "/api/admin/users",
            json={
                "email": new_email,
                "full_name": "New User",
                "role": "HOTEL_ADMIN",
                "status": "ACTIVE",
                "password": "very-secure-password",
            },
        )

    assert response.status_code == 201
    assert response.json()["org_id"] == str(org_a)
    assert response.json()["email"] == new_email.lower()


@pytest.mark.asyncio
async def test_non_admin_is_forbidden(seeded_admin_users) -> None:  # type: ignore[no-untyped-def]
    org_a = seeded_admin_users["org_a"]
    staff_id = uuid.uuid4()
    async with _client_for_org(
        org_id=org_a, user_id=staff_id, role=UserRole.STAFF, email="staff@hotel-a.example.com"
    ) as client:
        response = await client.get("/api/admin/users")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_get_user_returns_same_org_user(seeded_admin_users) -> None:  # type: ignore[no-untyped-def]
    org_a = seeded_admin_users["org_a"]
    admin_id = seeded_admin_users["admin_id"]
    user_a2_id = seeded_admin_users["user_a2_id"]
    email_admin_a = seeded_admin_users["email_admin_a"]

    async with _client_for_org(
        org_id=org_a, user_id=admin_id, role=UserRole.IT_ADMIN, email=str(email_admin_a)
    ) as client:
        response = await client.get(f"/api/admin/users/{user_a2_id}")

    assert response.status_code == 200
    assert response.json()["org_id"] == str(org_a)
    assert response.json()["id"] == str(user_a2_id)


@pytest.mark.asyncio
async def test_get_user_returns_404_for_other_org_user(seeded_admin_users) -> None:  # type: ignore[no-untyped-def]
    org_a = seeded_admin_users["org_a"]
    admin_id = seeded_admin_users["admin_id"]
    user_b_id = seeded_admin_users["user_b_id"]
    email_admin_a = seeded_admin_users["email_admin_a"]

    async with _client_for_org(
        org_id=org_a, user_id=admin_id, role=UserRole.IT_ADMIN, email=str(email_admin_a)
    ) as client:
        response = await client.get(f"/api/admin/users/{user_b_id}")

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_update_user_changes_same_org_user(
    seeded_admin_users, monkeypatch: pytest.MonkeyPatch
) -> None:  # type: ignore[no-untyped-def]
    org_a = seeded_admin_users["org_a"]
    admin_id = seeded_admin_users["admin_id"]
    user_a2_id = seeded_admin_users["user_a2_id"]
    email_admin_a = seeded_admin_users["email_admin_a"]
    monkeypatch.setattr("app.modules.admin.users.router.hash_password", lambda _password: "updated")

    async with _client_for_org(
        org_id=org_a, user_id=admin_id, role=UserRole.IT_ADMIN, email=str(email_admin_a)
    ) as client:
        response = await client.patch(
            f"/api/admin/users/{user_a2_id}",
            json={"full_name": "Updated User", "password": "new-secure-password"},
        )

    assert response.status_code == 200
    assert response.json()["full_name"] == "Updated User"
    assert response.json()["org_id"] == str(org_a)
    assert response.json()["id"] == str(user_a2_id)


@pytest.mark.asyncio
async def test_delete_user_removes_same_org_user(seeded_admin_users) -> None:  # type: ignore[no-untyped-def]
    org_a = seeded_admin_users["org_a"]
    admin_id = seeded_admin_users["admin_id"]
    user_a2_id = seeded_admin_users["user_a2_id"]
    email_admin_a = seeded_admin_users["email_admin_a"]

    async with _client_for_org(
        org_id=org_a, user_id=admin_id, role=UserRole.IT_ADMIN, email=str(email_admin_a)
    ) as client:
        response = await client.delete(f"/api/admin/users/{user_a2_id}")

    assert response.status_code == 204
