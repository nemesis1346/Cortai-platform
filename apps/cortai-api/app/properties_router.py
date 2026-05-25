from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep
from app.properties_schemas import PropertyPublicRead

router = APIRouter(prefix="/api/properties", tags=["properties"])


@router.get("", response_model=list[PropertyPublicRead])
async def list_my_properties(principal: PrincipalDep, session: SessionDep) -> list[PropertyPublicRead]:
    # RLS + TenantContextMiddleware keep this org-scoped.
    rows = (
        await session.execute(
            text(
                """
                select id, name, slug
                from properties
                where org_id = :org_id and status = 'ACTIVE'
                order by name asc
                """
            ),
            {"org_id": str(principal.org_id)},
        )
    ).mappings().all()
    return [PropertyPublicRead(**dict(r)) for r in rows]

