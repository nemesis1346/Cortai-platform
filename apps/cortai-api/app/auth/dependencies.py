from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from app.auth.schemas import Principal
from app.auth.security import decode_token, token_from_request


async def get_principal(request: Request) -> Principal:
    principal = getattr(request.state, "principal", None)
    if principal is not None:
        return principal

    token = token_from_request(request)
    if token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return decode_token(token)


PrincipalDep = Annotated[Principal, Depends(get_principal)]
