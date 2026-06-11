import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.auth.schemas import Principal
from app.db import SessionLocal, get_session, set_current_org
from app.main import create_app
from app.models import Organization, User, UserRole, UserStatus


@pytest_asyncio.fixture
async def seeded_messaging_audit_env() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    prop_id = uuid.uuid4()
    guest_id = uuid.uuid4()
    thread_pk = uuid.uuid4()
    now = datetime.now(UTC)

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="Messaging Audit Org", slug=f"msg-audit-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        session.add(
            User(
                id=user_id,
                org_id=org_id,
                email=f"msg-audit-{org_id}@example.com",
                full_name="Messaging Audit User",
                role=UserRole.STAFF,
                status=UserStatus.ACTIVE,
                password_hash="hash",  # noqa: S106
                created_at=now,
                updated_at=now,
            )
        )
        await session.execute(
            text(
                """
                insert into properties (id, org_id, name, slug, created_at, updated_at, status, room_count)
                values (:p, :org, 'Audit Hotel', :slug, :now, :now, 'ACTIVE', 100)
                """
            ),
            {"p": prop_id, "org": org_id, "slug": f"audit-hotel-{org_id}", "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.guests (id, org_id, first_name, last_name, vip, language, preferences_json, created_at, updated_at)
                values (:g, :org, 'Audit', 'Guest', false, 'en', '{}'::jsonb, :now, :now)
                """
            ),
            {"g": guest_id, "org": org_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.guest_message_threads (
                  id, org_id, property_id, thread_id, guest_id, channel, status,
                  assigned_to_user_id, unread_count, last_message_at, created_at, updated_at
                )
                values (:t, :org, :p, 'audit-thread', :g, 'sms', 'open', null, 1, :now, :now, :now)
                """
            ),
            {"t": thread_pk, "org": org_id, "p": prop_id, "g": guest_id, "now": now},
        )
        await session.commit()

    yield {"org_id": org_id, "user_id": user_id, "thread_pk": thread_pk}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("truncate table audit.change_log"))
        await session.execute(text("delete from realtime.event_log where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guest_messages where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guest_message_threads where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guests where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from users where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


def _client(*, org_id: uuid.UUID) -> AsyncClient:
    app = create_app()

    async def override_session():  # type: ignore[no-untyped-def]
        async with SessionLocal() as session:
            await set_current_org(session, str(org_id))
            yield session

    app.dependency_overrides[get_session] = override_session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_messaging_assign_mutation_is_audited(seeded_messaging_audit_env) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_messaging_audit_env["org_id"]
    user_id = seeded_messaging_audit_env["user_id"]
    thread_pk = seeded_messaging_audit_env["thread_pk"]

    def _fake_decode_token(_token: str):  # type: ignore[no-untyped-def]
        return Principal(user_id=user_id, org_id=org_id, email="audit@example.com", role=UserRole.STAFF)

    import app.middleware.tenant as tenant_mw

    tenant_mw.decode_token = _fake_decode_token  # type: ignore[assignment]

    async with _client(org_id=org_id) as client:
        resp = await client.post(
            f"/api/operations/messaging/threads/{thread_pk}/assign",
            json={"assigned_to_user_id": str(user_id)},
            headers={"user-agent": "pytest"},
            cookies={"cortai_access_token": "test-token"},
        )

    assert resp.status_code == 200

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        row = (
            await session.execute(
                text(
                    """
                    select action, entity_type, org_id, user_id, after_json
                    from audit.change_log
                    where org_id = :org
                    order by ts desc
                    limit 1
                    """
                ),
                {"org": org_id},
            )
        ).mappings().one()

    assert row["action"] == "post"
    assert row["entity_type"] == "operations"
    assert row["org_id"] == org_id
    assert row["user_id"] == user_id
    assert row["after_json"]["assigned_to_user_id"] == str(user_id)

