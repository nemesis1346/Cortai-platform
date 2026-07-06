from collections.abc import Callable
from typing import Annotated, cast

from fastapi import Depends, HTTPException, Request, status

from app.auth.revocation import is_token_revoked
from app.auth.schemas import Principal
from app.auth.security import decode_token, require_roles, token_from_request
from app.models import UserRole


async def get_principal(request: Request) -> Principal:
    principal = getattr(request.state, "principal", None)
    if principal is not None:
        return cast(Principal, principal)

    token = token_from_request(request)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )
    principal = decode_token(token)

    if await is_token_revoked(principal.user_id, principal.iat, principal.jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session invalidated. Please log in again.",
        )

    return principal


PrincipalDep = Annotated[Principal, Depends(get_principal)]


def require_roles_dep(allowed_roles: set[UserRole]) -> Callable[[PrincipalDep], Principal]:
    """
    Reusable RBAC dependency.

    Usage:
      principal: Annotated[Principal, Depends(require_roles_dep({UserRole.IT_ADMIN}))]
    """

    def _dep(principal: PrincipalDep) -> Principal:
        require_roles(principal, allowed_roles)
        return principal

    return _dep
