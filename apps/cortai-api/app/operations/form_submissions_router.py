from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import text

from app.auth.dependencies import PrincipalDep
from app.db import SessionDep
from app.models import UserRole
from app.operations.form_submissions_schemas import (
    REVIEW_STATUSES,
    FormSubmissionCreate,
    FormSubmissionList,
    FormSubmissionRead,
    FormSubmissionStatusUpdate,
)
from app.operations.rbac import OperationsPrincipalDep

router = APIRouter(prefix="/form-submissions", tags=["operations-form-submissions"])

_SELECT = """
    select
      fs.id, fs.org_id, fs.form_definition_id, fs.form_version,
      fs.submitted_by_user_id, fs.submitted_by_guest_id,
      fs.payload_json, fs.source_property_id, fs.status,
      fs.created_at, fs.updated_at, fs.submitted_at,
      fd.slug  as form_slug,
      fd.title_en as form_title_en,
      fd.title_fr as form_title_fr,
      fd.schema_json as form_schema_json,
      fd.ui_hints_json as ui_hints_json
    from platform.form_submissions fs
    join platform.form_definitions fd on fd.id = fs.form_definition_id
"""

_ADMIN_ROLES = {r.value for r in (UserRole.IT_ADMIN, UserRole.SERVICE_PROVIDER_ADMIN)}


def _is_admin(principal: PrincipalDep) -> bool:
    return principal.role.value in _ADMIN_ROLES


def _row_to_read(m: Any) -> FormSubmissionRead:
    return FormSubmissionRead.model_validate(dict(m))


async def _get_or_404(
    session: Any,
    *,
    submission_id: uuid.UUID,
    org_id: uuid.UUID,
    user_id: uuid.UUID | None = None,
) -> FormSubmissionRead:
    params: dict[str, object] = {
        "id": str(submission_id),
        "org_id": str(org_id),
    }
    extra = ""
    if user_id is not None:
        extra = " and fs.submitted_by_user_id = :user_id"
        params["user_id"] = str(user_id)

    row = await session.execute(
        text(f"{_SELECT} where fs.id = :id and fs.org_id = :org_id{extra}"),  # noqa: S608
        params,
    )
    m = row.mappings().first()
    if m is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found"
        )
    return _row_to_read(m)


@router.get("", response_model=FormSubmissionList)
async def list_submissions(
    principal: OperationsPrincipalDep,
    session: SessionDep,
    form_definition_id: uuid.UUID | None = None,
    sub_status: str | None = Query(default=None, alias="status"),
    source_property_id: uuid.UUID | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> FormSubmissionList:
    filters = ["fs.org_id = :org_id"]
    params: dict[str, object] = {"org_id": str(principal.org_id)}

    # Non-admins only see their own submissions.
    if not _is_admin(principal):
        filters.append("fs.submitted_by_user_id = :user_id")
        params["user_id"] = str(principal.user_id)

    if form_definition_id is not None:
        filters.append("fs.form_definition_id = :form_definition_id")
        params["form_definition_id"] = str(form_definition_id)
    if sub_status is not None:
        filters.append("fs.status = :status")
        params["status"] = sub_status
    if source_property_id is not None:
        filters.append("fs.source_property_id = :source_property_id")
        params["source_property_id"] = str(source_property_id)

    where = " where " + " and ".join(filters)

    total = await session.scalar(
        text(
            "select count(*) from platform.form_submissions fs"  # noqa: S608
            " join platform.form_definitions fd on fd.id = fs.form_definition_id"
            f"{where}"
        ),
        params,
    )
    rows = await session.execute(
        text(  # noqa: S608
            f"{_SELECT}{where} order by fs.created_at desc limit :limit offset :offset"
        ),
        {**params, "limit": page_size, "offset": (page - 1) * page_size},
    )
    items = [_row_to_read(m) for m in rows.mappings().all()]
    return FormSubmissionList(
        items=items, total=int(total or 0), page=page, page_size=page_size
    )


@router.get("/{submission_id}", response_model=FormSubmissionRead)
async def get_submission(
    submission_id: uuid.UUID,
    principal: OperationsPrincipalDep,
    session: SessionDep,
) -> FormSubmissionRead:
    # Non-admins can only fetch their own.
    user_id = None if _is_admin(principal) else principal.user_id
    return await _get_or_404(
        session, submission_id=submission_id, org_id=principal.org_id, user_id=user_id
    )


@router.post("", response_model=FormSubmissionRead, status_code=status.HTTP_201_CREATED)
async def create_submission(
    payload: FormSubmissionCreate,
    principal: OperationsPrincipalDep,
    session: SessionDep,
) -> FormSubmissionRead:
    # Verify the form exists, is published, and belongs to this org.
    fd = await session.execute(
        text(
            "select id, version, status from platform.form_definitions"
            " where id = :id and org_id = :org_id"
        ),
        {"id": str(payload.form_definition_id), "org_id": str(principal.org_id)},
    )
    fd_row = fd.mappings().first()
    if fd_row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Form definition not found"
        )
    if fd_row["status"] != "published":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only published forms can be submitted",
        )

    now = datetime.now(UTC)
    sub_status = "draft" if payload.save_as_draft else "submitted"
    submitted_at = None if payload.save_as_draft else now
    new_id = uuid.uuid4()

    await session.execute(
        text(
            "insert into platform.form_submissions"
            " (id, org_id, form_definition_id, form_version, submitted_by_user_id,"
            "  payload_json, source_property_id, status, submitted_at, created_at, updated_at)"
            " values (:id, :org_id, :form_definition_id, :form_version, :submitted_by_user_id,"
            "  :payload_json::jsonb, :source_property_id, :status, :submitted_at, :now, :now)"
        ).bindparams(sa.bindparam("payload_json", type_=sa.Text)),
        {
            "id": str(new_id),
            "org_id": str(principal.org_id),
            "form_definition_id": str(payload.form_definition_id),
            "form_version": int(fd_row["version"]),
            "submitted_by_user_id": str(principal.user_id),
            "payload_json": payload.payload_json,
            "source_property_id": str(payload.source_property_id)
            if payload.source_property_id
            else None,
            "status": sub_status,
            "submitted_at": submitted_at,
            "now": now,
        },
    )
    await session.commit()
    return await _get_or_404(
        session, submission_id=new_id, org_id=principal.org_id
    )


@router.patch("/{submission_id}/status", response_model=FormSubmissionRead)
async def update_submission_status(
    submission_id: uuid.UUID,
    payload: FormSubmissionStatusUpdate,
    principal: OperationsPrincipalDep,
    session: SessionDep,
) -> FormSubmissionRead:
    sub = await _get_or_404(
        session, submission_id=submission_id, org_id=principal.org_id
    )

    new_status = payload.status
    # Only admins can move a submission to reviewed / archived.
    if new_status in REVIEW_STATUSES and not _is_admin(principal):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can mark submissions as reviewed or archived",
        )
    # Only the owner can re-submit their own draft.
    if new_status == "submitted":
        if sub.submitted_by_user_id != principal.user_id and not _is_admin(principal):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Not your submission"
            )

    now = datetime.now(UTC)
    first_submit = new_status == "submitted" and sub.submitted_at is None
    submitted_at_sql = ", submitted_at = :now" if first_submit else ""

    await session.execute(
        text(
            f"update platform.form_submissions"  # noqa: S608
            f" set status = :status{submitted_at_sql}"
            " where id = :id and org_id = :org_id"
        ),
        {
            "status": new_status,
            "id": str(submission_id),
            "org_id": str(principal.org_id),
            "now": now,
        },
    )
    await session.commit()
    return await _get_or_404(
        session, submission_id=submission_id, org_id=principal.org_id
    )


@router.delete("/{submission_id}", response_model=FormSubmissionRead)
async def delete_submission(
    submission_id: uuid.UUID,
    principal: OperationsPrincipalDep,
    session: SessionDep,
) -> FormSubmissionRead:
    sub = await _get_or_404(
        session, submission_id=submission_id, org_id=principal.org_id
    )
    # Staff can only delete their own drafts; admins can delete any draft.
    if sub.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only draft submissions can be deleted",
        )
    if not _is_admin(principal) and sub.submitted_by_user_id != principal.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not your submission"
        )
    await session.execute(
        text(
            "delete from platform.form_submissions where id = :id and org_id = :org_id"
        ),
        {"id": str(submission_id), "org_id": str(principal.org_id)},
    )
    await session.commit()
    return sub