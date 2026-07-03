from __future__ import annotations

import redis.asyncio as aioredis

from app.config import get_settings

_client: aioredis.Redis | None = None  # type: ignore[type-arg]


def get_redis() -> aioredis.Redis | None:  # type: ignore[type-arg]
    """Shared async Redis client. Returns None if Redis is not configured."""
    global _client
    settings = get_settings()
    if not settings.redis_url:
        return None
    if _client is None:
        _client = aioredis.from_url(settings.redis_url, decode_responses=False)
    return _client