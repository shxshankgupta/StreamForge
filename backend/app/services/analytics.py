import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.event import ProcessedEvent
from app.services.redis_client import get_redis_client

settings = get_settings()
STATS_CACHE_KEY = "streamforge:stats:current"


def get_stats_payload(db: Session) -> dict:
    redis_client = get_redis_client()
    if redis_client is not None:
        cached = redis_client.get(STATS_CACHE_KEY)
        if cached:
            return json.loads(cached)

    window_start = datetime.now(timezone.utc) - timedelta(seconds=settings.stats_window_seconds)

    total_events = db.scalar(select(func.count(ProcessedEvent.id))) or 0
    recent_events = (
        db.scalar(
            select(func.count(ProcessedEvent.id)).where(ProcessedEvent.processed_at >= window_start)
        )
        or 0
    )
    top_categories_rows = db.execute(
        select(ProcessedEvent.category, func.count(ProcessedEvent.id).label("count"))
        .group_by(ProcessedEvent.category)
        .order_by(func.count(ProcessedEvent.id).desc(), ProcessedEvent.category.asc())
        .limit(5)
    ).all()

    payload = {
        "total_events": total_events,
        "events_per_second": round(recent_events / settings.stats_window_seconds, 2),
        "top_categories": [
            {"category": row.category, "count": int(row.count)} for row in top_categories_rows
        ],
    }

    if redis_client is not None:
        redis_client.setex(STATS_CACHE_KEY, settings.stats_cache_ttl_seconds, json.dumps(payload))

    return payload


def publish_stats_update(db: Session) -> None:
    redis_client = get_redis_client()
    if redis_client is not None:
        redis_client.delete(STATS_CACHE_KEY)
    payload = get_stats_payload(db)
    if redis_client is not None:
        redis_client.publish("streamforge:stats", json.dumps(payload))
