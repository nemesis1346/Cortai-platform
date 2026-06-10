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
async def seeded_org_with_menu_items() -> dict[str, uuid.UUID]:
    org_id = uuid.uuid4()
    now = datetime.now(UTC)
    item_a = uuid.uuid4()
    item_b = uuid.uuid4()

    async with SessionLocal() as session:
        session.add(Organization(id=org_id, name="FB Menu Org", slug=f"fb-menu-{org_id}"))
        await session.commit()

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(
            text(
                """
                insert into ops.menu_items (id, org_id, service, name_en, name_fr, price_cents, allergens, available, created_at, updated_at)
                values
                  (:a, :org, 'breakfast', 'Pancakes', 'Crêpes', 1200, array['gluten'], true, :now, :now),
                  (:b, :org, 'restaurant', 'Burger', null, 1800, array[]::text[], false, :now, :now)
                """
            ),
            {"a": item_a, "b": item_b, "org": org_id, "now": now},
        )
        await session.commit()

    yield {"org_id": org_id, "item_a": item_a, "item_b": item_b}

    async with SessionLocal() as session:
        await set_current_org(session, str(org_id))
        await session.execute(text("delete from ops.menu_items where org_id = :org"), {"org": org_id})
        await session.execute(text("delete from organizations where id = :org"), {"org": org_id})
        await session.commit()


@pytest.mark.asyncio
async def test_fb_menu_list(seeded_org_with_menu_items) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_org_with_menu_items["org_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get("/api/operations/fb/menu?page=1&page_size=50")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] >= 2
    assert isinstance(body["items"], list)
    assert "name_en" in body["items"][0]


@pytest.mark.asyncio
async def test_fb_menu_list_filters(seeded_org_with_menu_items) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_org_with_menu_items["org_id"]
    async with _client_for_org(org_id=org_id) as client:
        resp = await client.get("/api/operations/fb/menu?service=breakfast&available=true&page=1&page_size=50")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] >= 1
    assert all(it["service"] == "breakfast" for it in body["items"])
    assert all(it["available"] is True for it in body["items"])


@pytest.mark.asyncio
async def test_fb_menu_create_and_patch(seeded_org_with_menu_items) -> None:  # type: ignore[no-untyped-def]
    org_id = seeded_org_with_menu_items["org_id"]
    async with _client_for_org(org_id=org_id) as client:
        created = await client.post(
            "/api/operations/fb/menu",
            json={
                "service": "breakfast",
                "name_en": "Omelette",
                "name_fr": "Omelette",
                "price_cents": 1500,
                "allergens": ["eggs"],
                "available": True,
            },
        )
        assert created.status_code == 201
        item_id = created.json()["id"]

        patched = await client.patch(
            f"/api/operations/fb/menu/{item_id}",
            json={"available": False, "price_cents": 1600},
        )
        assert patched.status_code == 200
        assert patched.json()["available"] is False
        assert patched.json()["price_cents"] == 1600

