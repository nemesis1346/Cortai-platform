import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from app.db import SessionLocal, set_current_org


@pytest.mark.asyncio
async def test_users_rls_isolates_two_organizations() -> None:
    org_a = uuid.uuid4()
    org_b = uuid.uuid4()
    role_name = f"rls_test_{uuid.uuid4().hex}"
    now = datetime.now(UTC)

    async with SessionLocal() as session:
        await session.execute(
            text(
                """
                insert into organizations (id, name, slug, created_at, updated_at)
                values
                  (:org_a, 'RLS Hotel A', :slug_a, :now, :now),
                  (:org_b, 'RLS Hotel B', :slug_b, :now, :now)
                """
            ),
            {
                "org_a": org_a,
                "org_b": org_b,
                "slug_a": f"rls-hotel-a-{org_a}",
                "slug_b": f"rls-hotel-b-{org_b}",
                "now": now,
            },
        )
        await set_current_org(session, str(org_a))
        await session.execute(
            text(
                """
                insert into users (
                    id,
                    org_id,
                    email,
                    full_name,
                    role,
                    status,
                    password_hash,
                    created_at,
                    updated_at
                )
                values
                  (
                    :user_a,
                    :org_a,
                    :email_a,
                    'Hotel A Admin',
                    'IT_ADMIN',
                    'ACTIVE',
                    'hash',
                    :now,
                    :now
                  )
                """
            ),
            {
                "user_a": uuid.uuid4(),
                "org_a": org_a,
                "email_a": f"admin-{org_a}@hotel-a.example.com",
                "now": now,
            },
        )
        await set_current_org(session, str(org_b))
        await session.execute(
            text(
                """
                insert into users (
                    id,
                    org_id,
                    email,
                    full_name,
                    role,
                    status,
                    password_hash,
                    created_at,
                    updated_at
                )
                values
                  (
                    :user_b,
                    :org_b,
                    :email_b,
                    'Hotel B Admin',
                    'IT_ADMIN',
                    'ACTIVE',
                    'hash',
                    :now,
                    :now
                  )
                """
            ),
            {
                "user_b": uuid.uuid4(),
                "org_b": org_b,
                "email_b": f"admin-{org_b}@hotel-b.example.com",
                "now": now,
            },
        )
        await session.commit()

    try:
        async with SessionLocal() as session:
            await session.execute(text(f'create role "{role_name}"'))  # noqa: S608
            await session.execute(
                text(f'grant usage on schema public to "{role_name}"')  # noqa: S608
            )
            await session.execute(text(f'grant select on users to "{role_name}"'))  # noqa: S608
            await session.commit()

        async with SessionLocal() as session:
            await session.execute(text(f'set local role "{role_name}"'))  # noqa: S608
            await set_current_org(session, str(org_a))
            emails = (
                await session.scalars(text("select email from users order by email"))
            ).all()

        assert emails == [f"admin-{org_a}@hotel-a.example.com"]

        async with SessionLocal() as session:
            await session.execute(text(f'set local role "{role_name}"'))  # noqa: S608
            await set_current_org(session, str(org_b))
            emails = (
                await session.scalars(text("select email from users order by email"))
            ).all()

        assert emails == [f"admin-{org_b}@hotel-b.example.com"]
    finally:
        async with SessionLocal() as session:
            await session.execute(text("reset role"))
            await set_current_org(session, str(org_a))
            await session.execute(
                text("delete from users where org_id = :org_id"),
                {"org_id": org_a},
            )
            await set_current_org(session, str(org_b))
            await session.execute(
                text("delete from users where org_id = :org_id"),
                {"org_id": org_b},
            )
            await session.execute(
                text("delete from organizations where id in (:org_a, :org_b)"),
                {"org_a": org_a, "org_b": org_b},
            )
            await session.execute(
                text(f'revoke select on users from "{role_name}"')  # noqa: S608
            )
            await session.execute(
                text(f'revoke usage on schema public from "{role_name}"')  # noqa: S608
            )
            await session.execute(text(f'drop role if exists "{role_name}"'))  # noqa: S608
            await session.commit()
