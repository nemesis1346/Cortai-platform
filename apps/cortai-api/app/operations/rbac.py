from __future__ import annotations

from typing import Annotated

from fastapi import Depends

from app.auth.dependencies import PrincipalDep, require_roles_dep
from app.models import UserRole

OPERATIONS_ROLES = {
    UserRole.IT_ADMIN,
    UserRole.SERVICE_PROVIDER_ADMIN,
    UserRole.HOTEL_ADMIN,
    UserRole.STAFF,
}

OperationsPrincipalDep = Annotated[PrincipalDep, Depends(require_roles_dep(OPERATIONS_ROLES))]

