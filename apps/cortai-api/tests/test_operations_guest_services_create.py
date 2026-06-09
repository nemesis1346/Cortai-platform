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
from app.models import Organization, UserRole


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
async def seeded_guest_services_create() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    prop_id = uuid.uuid4()
    room_id = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="GS Create Org", slug=f"gs-create-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
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
        await session.commit()

    yield {"org_id": org_id, "property_id": prop_id, "room_id": room_id}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.action_queue where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.guest_service_requests where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from ops.rooms where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from properties where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_guest_services_create_inserts_request_and_action_queue(seeded_guest_services_create) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_guest_services_create["org_id"]
    prop_id = seeded_guest_services_create["property_id"]
    room_id = seeded_guest_services_create["room_id"]

    async with _client_for_org(org_id=org_id) as client:
        resp = await client.post(
            "/api/operations/guest-services",
            json={"property_id": str(prop_id), "room_id": str(room_id), "type": "towels", "note": "extra towels"},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["ok"] is True

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        req = (
            await session.execute(
                text(
                    """
                    select type, status, note, action_queue_item_id
                    from ops.guest_service_requests
                    where org_id = :org and property_id = :prop and room_id = :room
                    order by created_at desc
                    limit 1
                    """
                ),
                {"org": str(org_id), "prop": str(prop_id), "room": str(room_id)},
            )
        ).mappings().one()
        assert req["type"] == "towels"
        assert req["status"] == "pending"
        assert req["action_queue_item_id"] is not None

        aq = (
            await session.execute(
                text(
                    """
                    select type, source, status
                    from ops.action_queue
                    where org_id = :org and property_id = :prop and room_id = :room
                    order by created_at desc
                    limit 1
                    """
                ),
                {"org": str(org_id), "prop": str(prop_id), "room": str(room_id)},
            )
        ).mappings().one()
        assert aq["type"] == "request"
        assert aq["source"] == "guest_services"
        assert aq["status"] == "pending"

