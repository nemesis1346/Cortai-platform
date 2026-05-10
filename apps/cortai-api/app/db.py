from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
engine: AsyncEngine = create_async_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session(request: Request) -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        principal = getattr(request.state, "principal", None)
        if principal is not None:
            await set_current_org(session, str(principal.org_id))
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def set_current_org(session: AsyncSession, org_id: str) -> None:
    await session.execute(text("select set_config('app.current_org_id', :org_id, true)"), {"org_id": org_id})


async def get_db_version(session: AsyncSession) -> str:
    version = await session.scalar(text("select version()"))
    return str(version)
