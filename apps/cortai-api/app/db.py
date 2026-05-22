import os
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import pool, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()

# Async connection pools are bound to a single event loop. During pytest runs,
# tests may execute across multiple loops (e.g. sync TestClient vs async tests),
# which can lead to "Future attached to a different loop" errors when pooled
# connections are reused. Disable pooling under pytest to keep connections
# loop-local and short-lived.
_is_pytest = "PYTEST_CURRENT_TEST" in os.environ
engine: AsyncEngine = create_async_engine(
    settings.database_url, pool_pre_ping=True, poolclass=pool.NullPool if _is_pytest else None
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session(request: Request) -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        # Make the session available to middleware (best-effort).
        request.state.db = session
        principal = getattr(request.state, "principal", None)
        if principal is not None:
            await set_current_org(session, str(principal.org_id))
        try:
            yield session
        finally:
            # Avoid leaking the session onto a reused Request object (tests).
            request.state.db = None


SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def set_current_org(session: AsyncSession, org_id: str) -> None:
    await session.execute(
        text("select set_config('app.current_org_id', :org_id, true)"),
        {"org_id": org_id},
    )


async def get_db_version(session: AsyncSession) -> str:
    version = await session.scalar(text("select version()"))
    return str(version)
