from pydantic import BaseModel


class CategoryStat(BaseModel):
    category: str
    count: int


class LatencyStats(BaseModel):
    p50: float
    p95: float
    p99: float


class StatsResponse(BaseModel):
    total_events: int
    events_per_second: float
    top_categories: list[CategoryStat]
    queue_depth: int
    latency: LatencyStats
