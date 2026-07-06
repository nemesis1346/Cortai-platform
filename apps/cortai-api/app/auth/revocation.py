"""SEC-03 — token revocation on password change.

Strategy: per-user "revoke_before" timestamp in Redis.
  Key  : revoke_before:{user_id}
  Value: unix timestamp (int) — any token with iat < this value is invalid
  TTL  : jwt_ttl_seconds — self-cleans once all pre-change tokens have expired

This is O(1) per request regardless of how many active sessions a user has,
and correctly invalidates tokens across all devices simultaneously.

The jti claim is present in every token for audit/logging purposes and enables
per-token revocation in the future without schema changes.
"""

from __future__ import annotations

import logging
import uuid

from app.config import get_settings
from app.redis import get_redis

log = logging.getLogger(__name__)

_KEY_PREFIX = "revoke_before"


def _key(user_id: str | uuid.UUID) -> str:
    return f"{_KEY_PREFIX}:{user_id}"


async def invalidate_user_sessions(user_id: str | uuid.UUID) -> None:
    """Mark all tokens issued before now as invalid for this user.

    Writes revoke_before:{user_id} = current unix timestamp with
    TTL = jwt_ttl_seconds so the key self-cleans once all pre-change
    tokens have naturally expired. Fail-silent if Redis is unavailable.
    """
    redis = get_redis()
    if redis is None:
        log.warning("revocation: Redis not configured — session invalidation skipped for %s", user_id)
        return
    try:
        import time
        ttl = get_settings().jwt_ttl_seconds
        await redis.set(_key(user_id), int(time.time()), ex=ttl)
    except Exception:  # noqa: BLE001
        log.exception("revocation: failed to write revoke_before for %s", user_id)


async def is_token_revoked(user_id: str | uuid.UUID, token_iat: int, jti: str) -> bool:
    """Return True if this token should be rejected.

    Checks whether the token was issued before the last password change.
    Fail-open (returns False) if Redis is unavailable.
    """
    redis = get_redis()
    if redis is None:
        return False
    try:
        raw = await redis.get(_key(user_id))
        if raw is None:
            return False
        # decode_responses=False → raw is bytes; decode before int conversion
        revoke_before_ts = int(raw.decode() if isinstance(raw, bytes) else raw)
        if token_iat < revoke_before_ts:
            log.info("revocation: rejected token jti=%s user=%s iat=%d revoke_before=%d",
                     jti, user_id, token_iat, revoke_before_ts)
            return True
        return False
    except Exception:  # noqa: BLE001
        log.exception("revocation: Redis check failed for jti=%s — allowing request", jti)
        return False