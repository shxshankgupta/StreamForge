from pydantic import BaseModel


class CategoryStat(BaseModel):
    category: str
    count: int


class StatsResponse(BaseModel):
    total_events: int
    events_per_second: float
    top_categories: list[CategoryStat]
