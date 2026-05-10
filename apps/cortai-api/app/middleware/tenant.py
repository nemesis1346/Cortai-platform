from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware

from app.auth.security import decode_token, token_from_request
from app.db import SessionLocal, set_current_org


class TenantContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        token = token_from_request(request)
        if token is None:
            return await call_next(request)

        principal = decode_token(token)
        request.state.principal = principal

        session: AsyncSession | None = getattr(request.state, "db", None)
        if session is not None:
            await set_current_org(session, str(principal.org_id))
        return await call_next(request)
