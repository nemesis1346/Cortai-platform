import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.db import SessionLocal, get_session
from app.main import create_app


@pytest_asyncio.fixture
async def client() -> AsyncClient:
    app = create_app()

    async def override_session():  # type: ignore[no-untyped-def]
        async with SessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_health_shape(client: AsyncClient) -> None:
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()

    assert body["status"] in {"ok", "degraded"}
    assert set(body.keys()) == {"status", "db", "redis", "mqtt", "build"}

    assert set(body["db"].keys()) == {"ok", "version"}
    assert isinstance(body["db"]["ok"], bool)

    assert set(body["redis"].keys()) == {"ok"}
    assert isinstance(body["redis"]["ok"], bool)

    assert set(body["mqtt"].keys()) == {"ok", "last_seen"}
    assert isinstance(body["mqtt"]["ok"], bool)

    assert set(body["build"].keys()) == {"sha", "version"}
    assert isinstance(body["build"]["sha"], str)
    assert isinstance(body["build"]["version"], str)

