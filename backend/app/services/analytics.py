import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.event import ProcessedEvent
from app.services.redis_client import get_redis_client

settings = get_settings()
logger = get_logger(__name__)
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

    queue_depth = 0
    if redis_client is not None:
        try:
            queue_depth = redis_client.llen("celery") or 0
        except Exception as exc:
            logger.warning("failed_to_get_queue_depth", extra={"error": str(exc)})

    # Calculate latency percentiles for the last 100 successful events
    recent_latencies_query = (
        select(ProcessedEvent.processed_at, ProcessedEvent.occurred_at)
        .where(ProcessedEvent.status == "processed")
        .order_by(ProcessedEvent.processed_at.desc())
        .limit(100)
    )
    rows = db.execute(recent_latencies_query).all()

    latencies = []
    for row in rows:
        if row.processed_at and row.occurred_at:
            p_at = row.processed_at
            o_at = row.occurred_at
            if p_at.tzinfo is None:
                p_at = p_at.replace(tzinfo=timezone.utc)
            if o_at.tzinfo is None:
                o_at = o_at.replace(tzinfo=timezone.utc)
            diff = (p_at - o_at).total_seconds()
            latencies.append(diff)

    latencies.sort()
    n = len(latencies)

    def get_percentile(p: float) -> float:
        if n == 0:
            return 0.0
        idx = (n - 1) * p
        low = int(idx)
        high = min(low + 1, n - 1)
        val = latencies[low] + (latencies[high] - latencies[low]) * (idx - low)
        return round(val, 4)

    payload = {
        "total_events": total_events,
        "events_per_second": round(recent_events / settings.stats_window_seconds, 2),
        "top_categories": [
            {"category": row.category, "count": int(row.count)} for row in top_categories_rows
        ],
        "queue_depth": queue_depth,
        "latency": {
            "p50": get_percentile(0.50),
            "p95": get_percentile(0.95),
            "p99": get_percentile(0.99),
        },
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
