import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep, require_roles_dep
from app.db import SessionDep
from app.models import UserRole
from app.modules.admin.forms.schemas import (
    FormDefinitionCreate,
    FormDefinitionList,
    FormDefinitionRead,
    FormDefinitionUpdate,
)

router = APIRouter(prefix="/api/admin/form-definitions", tags=["admin-forms"])
ADMIN_ROLES = {UserRole.IT_ADMIN, UserRole.SERVICE_PROVIDER_ADMIN}
AdminPrincipalDep = Annotated[PrincipalDep, Depends(require_roles_dep(ADMIN_ROLES))]

_SELECT = (
    "select id, org_id, slug, title_en, title_fr, schema_json, ui_hints_json,"
    " version, status, created_at, updated_at, published_at"
    " from platform.form_definitions"
)


def _row_to_read(row: Any) -> FormDefinitionRead:
    return FormDefinitionRead.model_validate(dict(row._mapping))


async def _get_or_404(
    session: Any, *, form_id: uuid.UUID, org_id: uuid.UUID
) -> FormDefinitionRead:
    row = await session.execute(
        text(f"{_SELECT} where id = :id and org_id = :org_id"),
        {"id": str(form_id), "org_id": str(org_id)},
    )
    m = row.mappings().first()
    if m is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Form not found")
    return FormDefinitionRead.model_validate(dict(m))


@router.get("", response_model=FormDefinitionList)
async def list_forms(
    principal: AdminPrincipalDep,
    session: SessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    form_status: str | None = Query(default=None, alias="status"),
    search: str | None = None,
) -> FormDefinitionList:
    filters = ["org_id = :org_id"]
    params: dict[str, object] = {"org_id": str(principal.org_id)}

    if form_status:
        filters.append("status = :status")
        params["status"] = form_status
    if search:
        filters.append(  # noqa: S608
            "(lower(title_en) like :search"
            " or lower(title_fr) like :search"
            " or lower(slug) like :search)"
        )
        params["search"] = f"%{search.lower()}%"

    where = " where " + " and ".join(filters)
    total_row = await session.scalar(
        text(f"select count(*) from platform.form_definitions{where}"),  # noqa: S608
        params,
    )
    rows = await session.execute(
        text(
            f"{_SELECT}{where}"
            " order by created_at desc"
            " limit :limit offset :offset"
        ),
        {**params, "limit": page_size, "offset": (page - 1) * page_size},
    )
    items = [FormDefinitionRead.model_validate(dict(m)) for m in rows.mappings().all()]
    return FormDefinitionList(
        items=items,
        total=int(total_row or 0),
        page=page,
        page_size=page_size,
    )


@router.get("/by-slug/{slug}", response_model=FormDefinitionRead)
async def get_form_by_slug(
    slug: str, principal: PrincipalDep, session: SessionDep
) -> FormDefinitionRead:
    """Fetch the latest published version of a form by slug. All authenticated roles."""
    row = await session.execute(
        text(
            f"{_SELECT}"
            " where org_id = :org_id and slug = :slug and status = 'published'"
            " order by version desc limit 1"
        ),
        {"org_id": str(principal.org_id), "slug": slug},
    )
    m = row.mappings().first()
    if m is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Form not found or not published",
        )
    return FormDefinitionRead.model_validate(dict(m))


@router.get("/{form_id}", response_model=FormDefinitionRead)
async def get_form(
    form_id: uuid.UUID, principal: AdminPrincipalDep, session: SessionDep
) -> FormDefinitionRead:
    return await _get_or_404(session, form_id=form_id, org_id=principal.org_id)


@router.post("", response_model=FormDefinitionRead, status_code=status.HTTP_201_CREATED)
async def create_form(
    payload: FormDefinitionCreate, principal: AdminPrincipalDep, session: SessionDep
) -> FormDefinitionRead:
    # Check slug uniqueness within org (version 1 for new forms)
    existing = await session.scalar(
        text(
            "select id from platform.form_definitions"
            " where org_id = :org_id and slug = :slug and version = 1"
        ),
        {"org_id": str(principal.org_id), "slug": payload.slug},
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A form with this slug already exists (version 1)",
        )

    new_id = uuid.uuid4()
    await session.execute(
        text(
            "insert into platform.form_definitions"
            " (id, org_id, slug, title_en, title_fr, schema_json, ui_hints_json, version, status)"
            " values (:id, :org_id, :slug, :title_en, :title_fr,"
            "  :schema_json::jsonb, :ui_hints_json::jsonb, 1, 'draft')"
        ).bindparams(
            sa.bindparam("schema_json", type_=sa.Text),
            sa.bindparam("ui_hints_json", type_=sa.Text),
        ),
        {
            "id": str(new_id),
            "org_id": str(principal.org_id),
            "slug": payload.slug,
            "title_en": payload.title_en,
            "title_fr": payload.title_fr,
            "schema_json": payload.schema_json,
            "ui_hints_json": payload.ui_hints_json,
        },
    )
    await session.commit()
    return await _get_or_404(session, form_id=new_id, org_id=principal.org_id)


@router.patch("/{form_id}", response_model=FormDefinitionRead)
async def update_form(
    form_id: uuid.UUID,
    payload: FormDefinitionUpdate,
    principal: AdminPrincipalDep,
    session: SessionDep,
) -> FormDefinitionRead:
    form = await _get_or_404(session, form_id=form_id, org_id=principal.org_id)
    if form.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only draft forms can be edited",
        )
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    parts: list[str] = []
    params: dict[str, object] = {"id": str(form_id), "org_id": str(principal.org_id)}
    bind_params: list[sa.BindParameter[Any]] = []

    for field, value in data.items():
        if field in {"schema_json", "ui_hints_json"}:
            parts.append(f"{field} = :{field}::jsonb")
            bind_params.append(sa.bindparam(field, type_=sa.Text))
        else:
            parts.append(f"{field} = :{field}")
        params[field] = value

    stmt = text(
        f"update platform.form_definitions set {', '.join(parts)}"  # noqa: S608
        " where id = :id and org_id = :org_id"
    )
    if bind_params:
        stmt = stmt.bindparams(*bind_params)

    await session.execute(stmt, params)
    await session.commit()
    return await _get_or_404(session, form_id=form_id, org_id=principal.org_id)


@router.post("/{form_id}/publish", response_model=FormDefinitionRead)
async def publish_form(
    form_id: uuid.UUID, principal: AdminPrincipalDep, session: SessionDep
) -> FormDefinitionRead:
    form = await _get_or_404(session, form_id=form_id, org_id=principal.org_id)
    if form.status == "published":
        return form
    if form.status == "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Archived forms cannot be published",
        )
    await session.execute(
        text(
            "update platform.form_definitions"
            " set status = 'published', published_at = :now"
            " where id = :id and org_id = :org_id"
        ),
        {"id": str(form_id), "org_id": str(principal.org_id), "now": datetime.now(UTC)},
    )
    await session.commit()
    return await _get_or_404(session, form_id=form_id, org_id=principal.org_id)


@router.post("/{form_id}/archive", response_model=FormDefinitionRead)
async def archive_form(
    form_id: uuid.UUID, principal: AdminPrincipalDep, session: SessionDep
) -> FormDefinitionRead:
    await _get_or_404(session, form_id=form_id, org_id=principal.org_id)
    await session.execute(
        text(
            "update platform.form_definitions"
            " set status = 'archived'"
            " where id = :id and org_id = :org_id"
        ),
        {"id": str(form_id), "org_id": str(principal.org_id)},
    )
    await session.commit()
    return await _get_or_404(session, form_id=form_id, org_id=principal.org_id)


@router.delete("/{form_id}", response_model=FormDefinitionRead)
async def delete_form(
    form_id: uuid.UUID, principal: AdminPrincipalDep, session: SessionDep
) -> FormDefinitionRead:
    form = await _get_or_404(session, form_id=form_id, org_id=principal.org_id)
    if form.status == "published":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Published forms cannot be deleted; archive first",
        )
    await session.execute(
        text(
            "delete from platform.form_definitions where id = :id and org_id = :org_id"
        ),
        {"id": str(form_id), "org_id": str(principal.org_id)},
    )
    await session.commit()
    return form