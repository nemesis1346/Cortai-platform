import os
import uuid
from datetime import UTC, datetime

from sqlalchemy import select

from app.auth.security import hash_password
from app.db import SessionLocal, set_current_org
from app.models import Organization, User, UserRole, UserStatus


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


async def main() -> None:
    org_slug = _require_env("SEED_ORG_SLUG")
    admin_email = _require_env("SEED_ADMIN_EMAIL").lower()
    admin_password = _require_env("SEED_ADMIN_PASSWORD")
    admin_name = os.getenv("SEED_ADMIN_NAME", "Admin").strip() or "Admin"

    async with SessionLocal() as session:
        org = await session.scalar(select(Organization).where(Organization.slug == org_slug))
        if org is None:
            org = Organization(id=uuid.uuid4(), name=org_slug, slug=org_slug)
            session.add(org)
            await session.commit()
            await session.refresh(org)

        await set_current_org(session, str(org.id))

        user = await session.scalar(
            select(User).where(User.org_id == org.id, User.email == admin_email)
        )
        if user is None:
            user = User(
                org_id=org.id,
                email=admin_email,
                full_name=admin_name,
                role=UserRole.IT_ADMIN,
                status=UserStatus.ACTIVE,
                password_hash=hash_password(admin_password),
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
        else:
            user.full_name = admin_name
            user.role = UserRole.IT_ADMIN
            user.status = UserStatus.ACTIVE
            user.password_hash = hash_password(admin_password)
            await session.commit()

    print(f"Seed complete. org_slug={org_slug} admin_email={admin_email}")


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())

