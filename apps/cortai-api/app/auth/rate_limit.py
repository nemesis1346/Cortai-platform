"""SEC-01 — sliding-window rate limiter for auth endpoints.

10 requests / 5 minutes / IP via a Redis ZSET.
The Lua script makes check-and-increment atomic.
Logs the *first* lockout per IP per window to audit.change_log.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from fastapi import HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from app.db import SessionLocal, set_current_org
from app.redis import get_redis

log = logging.getLogger(__name__)

_LIMIT = 10
_WINDOW_MS = 5 * 60 * 1000  # 5 minutes in milliseconds

# Atomic sliding-window log algorithm.
# KEYS[1] = rate-limit key
# ARGV[1] = now_ms, ARGV[2] = window_ms, ARGV[3] = limit, ARGV[4] = unique member
# Returns {blocked, oldest_score_ms, count_at_check}
_LUA = """
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)

if count >= limit then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    return {1, tonumber(oldest[2] or now), count}
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {0, 0, count + 1}
"""


def client_ip(request: Request) -> str | None:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",", 1)[0].strip() or None
    return request.client.host if request.client else None


async def _audit_lockout(request: Request, ip: str) -> None:
    """Write auth.brute_force_lockout to audit.change_log — best effort.

    Resolves org_id from the request body (login only). Falls back to
    Python logger if the org cannot be determined (e.g. /refresh).
    """
    org_id: str | None = None
    try:
        raw = await request.body()
        data = json.loads(raw)
        org_slug = (data.get("org") or data.get("org_slug") or "").strip()
        if org_slug:
            async with SessionLocal() as s:
                row = await s.scalar(
                    text("SELECT id FROM organizations WHERE slug = :slug"),
                    {"slug": org_slug},
                )
                org_id = str(row) if row else None
    except Exception:  # noqa: BLE001
        pass

    if org_id is None:
        log.warning("auth.brute_force_lockout ip=%s (org unknown — audit skipped)", ip)
        return

    try:
        async with SessionLocal() as s:
            await set_current_org(s, org_id)
            await s.execute(
                text(
                    "INSERT INTO audit.change_log"
                    " (id, org_id, user_id, action, entity_type, entity_id,"
                    "  after_json, ts, ip, user_agent)"
                    " VALUES (:id, :org_id, NULL, 'post', 'auth.brute_force_lockout',"
                    "  NULL, :after_json, :ts, :ip, :ua)"
                ).bindparams(sa.bindparam("after_json", type_=postgresql.JSONB)),
                {
                    "id": str(uuid.uuid4()),
                    "org_id": org_id,
                    "after_json": {
                        "ip": ip,
                        "limit": _LIMIT,
                        "window_seconds": _WINDOW_MS // 1000,
                    },
                    "ts": datetime.now(UTC),
                    "ip": ip,
                    "ua": request.headers.get("user-agent"),
                },
            )
            await s.commit()
    except Exception:  # noqa: BLE001
        log.exception("Failed to write brute_force_lockout to audit")


async def auth_rate_limit(request: Request) -> None:
    """FastAPI dependency — raises 429 when an IP exceeds the auth rate limit."""
    redis = get_redis()
    if redis is None:
        return  # Redis not configured; degrade gracefully

    ip = client_ip(request)
    if not ip:
        return

    now_ms = int(time.time() * 1000)
    key = f"rl:auth:{ip}"
    member = str(uuid.uuid4())

    try:
        result = await redis.eval(_LUA, 1, key, now_ms, _WINDOW_MS, _LIMIT, member)
        blocked = int(result[0])
        oldest_ms = int(result[1])
        count = int(result[2])
    except Exception:  # noqa: BLE001
        log.exception("Redis rate-limit check failed — allowing request")
        return

    if not blocked:
        return

    # Log only on the first lockout (count just reached the limit).
    if count == _LIMIT:
        await _audit_lockout(request, ip)

    retry_after = max(1, int((oldest_ms + _WINDOW_MS - now_ms) / 1000))
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=f"Too many authentication attempts. Try again in {retry_after}s.",
        headers={"Retry-After": str(retry_after)},
    )