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


def _client_for_org(*, org_id: uuid.UUID) -> AsyncClient:
    app = create_app()

    async def override_principal() -> Principal:
        return Principal(user_id=uuid.uuid4(), org_id=org_id, email="user@example.com", role=UserRole.STAFF)

    async def override_session():  # type: ignore[no-untyped-def]
        async with SessionLocal() as session:
            await set_current_org(session, str(org_id))
            yield session

    app.dependency_overrides[get_principal] = override_principal
    app.dependency_overrides[get_session] = override_session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest_asyncio.fixture
async def seeded_gs_patch() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()
    room_id = uuid.uuid4()
    req_id = uuid.uuid4()
    aq_id = uuid.uuid4()
    assignee = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="GS Patch Org", slug=f"gs-patch-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        session.add(
            User(
                id=assignee,
                org_id=org_id,
                email=f"gs-assignee-{org_id}@example.com",
                full_name="GS Assignee",
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
                insert into properties (id, org_id, name, slug, created_at, updated_at, status)
                values (:id, :org_id, 'GS Hotel', :slug, :now, :now, 'ACTIVE')
                """
            ),
            {"id": prop_id, "org_id": org_id, "slug": f"gs-hotel-{org_id}", "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.rooms (id, org_id, property_id, room_number, floor, type, status, vip, created_at, updated_at)
                values (:room_id, :org_id, :prop_id, '101', 1, 'king', 'vacant_clean', false, :now, :now)
                """
            ),
            {"room_id": room_id, "org_id": org_id, "prop_id": prop_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.action_queue (
                  id, org_id, property_id, type, source, room_id, guest_id, title,
                  status, severity, assigned_to_user_id, sla_due_at, completed_at, parent_incident_id,
                  created_at, updated_at
                )
                values (
                  :id, :org_id, :prop_id, 'request', 'guest_services', :room_id, null, 'Guest service: towels',
                  'pending', 'low', null, null, null, null,
                  :now, :now
                )
                """
            ),
            {"id": aq_id, "org_id": org_id, "prop_id": prop_id, "room_id": room_id, "now": now},
        )
        await session.execute(
            text(
                """
                insert into ops.guest_service_requests (
                  id, org_id, property_id, room_id, guest_id, action_queue_item_id,
                  type, status, note, assigned_to_user_id, completed_at, created_at, updated_at
                )
                values (
                  :id, :org_id, :prop_id, :room_id, null, :aq_id,
                  'towels', 'pending', 'extra towels', null, null, :now, :now
                )
                """
            ),
            {"id": req_id, "org_id": org_id, "prop_id": prop_id, "room_id": room_id, "aq_id": aq_id, "now": now},
        )
        await session.commit()

    yield {"org_id": org_id, "request_id": req_id, "aq_id": aq_id, "assignee": assignee}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.guest_service_requests where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.action_queue where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.rooms where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from users where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_guest_services_patch_assign_and_complete_updates_action_queue(seeded_gs_patch) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_gs_patch["org_id"]
    request_id = seeded_gs_patch["request_id"]
    aq_id = seeded_gs_patch["aq_id"]
    assignee = seeded_gs_patch["assignee"]

    async with _client_for_org(org_id=org_id) as client:
        resp = await client.patch(
            f"/api/operations/guest-services/{request_id}",
            json={"status": "assigned", "assigned_to_user_id": str(assignee)},
        )
    assert resp.status_code == 200

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        req = (
            await session.execute(
                text("select status, assigned_to_user_id from ops.guest_service_requests where id = :id"),
                {"id": str(request_id)},
            )
        ).mappings().one()
        assert req["status"] == "assigned"
        assert str(req["assigned_to_user_id"]) == str(assignee)

        aq = (
            await session.execute(
                text("select status, assigned_to_user_id from ops.action_queue where id = :id"),
                {"id": str(aq_id)},
            )
        ).mappings().one()
        assert aq["status"] == "assigned"
        assert str(aq["assigned_to_user_id"]) == str(assignee)

    async with _client_for_org(org_id=org_id) as client:
        resp2 = await client.patch(f"/api/operations/guest-services/{request_id}", json={"status": "completed"})
    assert resp2.status_code == 200

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        req2 = (
            await session.execute(text("select status, completed_at from ops.guest_service_requests where id = :id"), {"id": str(request_id)})
        ).mappings().one()
        assert req2["status"] == "completed"
        assert req2["completed_at"] is not None

        aq2 = (
            await session.execute(text("select status, completed_at from ops.action_queue where id = :id"), {"id": str(aq_id)})
        ).mappings().one()
        assert aq2["status"] == "completed"
        assert aq2["completed_at"] is not None

