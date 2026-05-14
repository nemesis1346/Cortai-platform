import uuid

import pytest
from sqlalchemy import select, text

from app.db import SessionLocal, set_current_org
from app.models import Organization, User, UserRole, UserStatus
from app.scripts import seed


@pytest.mark.asyncio
async def test_seed_main_creates_and_updates(monkeypatch: pytest.MonkeyPatch) -> None:
    org_slug = f"seed-test-{uuid.uuid4().hex}"
    admin_email = f"seed-admin-{uuid.uuid4().hex}@example.com"

    monkeypatch.setenv("SEED_ORG_SLUG", org_slug)
    monkeypatch.setenv("SEED_ADMIN_EMAIL", admin_email)
    monkeypatch.setenv("SEED_ADMIN_PASSWORD", "pw")
    monkeypatch.setenv("SEED_ADMIN_NAME", "First Name")
    monkeypatch.setattr("app.scripts.seed.hash_password", lambda _pw: "hashed-1")

    await seed.main()

    async with SessionLocal() as session:
        org = await session.scalar(select(Organization).where(Organization.slug == org_slug))
        assert org is not None
        await set_current_org(session, str(org.id))
        user = await session.scalar(
            select(User).where(User.org_id == org.id, User.email == admin_email.lower())
        )
        assert user is not None
        assert user.full_name == "First Name"
        assert user.role == UserRole.IT_ADMIN
        assert user.status == UserStatus.ACTIVE
        assert user.password_hash == "hashed-1"

    # Run again to cover "update existing user" branch.
    monkeypatch.setenv("SEED_ADMIN_NAME", "Second Name")
    monkeypatch.setattr("app.scripts.seed.hash_password", lambda _pw: "hashed-2")

    await seed.main()

    async with SessionLocal() as session:
        org = await session.scalar(select(Organization).where(Organization.slug == org_slug))
        assert org is not None
        await set_current_org(session, str(org.id))
        user = await session.scalar(
            select(User).where(User.org_id == org.id, User.email == admin_email.lower())
        )
        assert user is not None
        assert user.full_name == "Second Name"
        assert user.password_hash == "hashed-2"

        # Cleanup (users table is protected by org RLS).
        await session.execute(text("delete from users where org_id = :org_id"), {"org_id": org.id})
        await session.execute(text("delete from organizations where id = :org_id"), {"org_id": org.id})
        await session.commit()


def test_seed_require_env_raises_for_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SEED_ORG_SLUG", raising=False)
    with pytest.raises(RuntimeError, match="SEED_ORG_SLUG is required"):
        seed._require_env("SEED_ORG_SLUG")  # noqa: SLF001

