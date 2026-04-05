from typing import Any

import redis

from app.core.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
logger = get_logger(__name__)
_client: redis.Redis | None = None


def get_redis_client() -> redis.Redis | None:
    global _client

    if not settings.redis_enabled:
        return None
    if _client is None:
        try:
            _client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
            _client.ping()
        except Exception as exc:
            logger.warning("redis_unavailable", extra={"error": str(exc)})
            _client = None
    return _client


def get_pubsub() -> Any | None:
    client = get_redis_client()
    if client is None:
        return None
    return client.pubsub()
