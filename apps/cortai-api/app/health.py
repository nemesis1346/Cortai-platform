from fastapi import APIRouter

from app.db import SessionDep, get_db_version

router = APIRouter(tags=["health"])


@router.get("/api/health")
async def health(session: SessionDep) -> dict[str, str]:
    return {"status": "ok", "db_version": await get_db_version(session)}
