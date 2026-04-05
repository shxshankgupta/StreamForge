from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator


class EventIngestItem(BaseModel):
    event_id: str = Field(default_factory=lambda: str(uuid4()), max_length=64)
    category: str = Field(min_length=1, max_length=128)
    payload: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("category")
    @classmethod
    def normalize_category(cls, value: str) -> str:
        return value.strip().lower()


class EventBatchIngestRequest(BaseModel):
    events: list[EventIngestItem] = Field(min_length=1, max_length=5000)


class EventBatchIngestResponse(BaseModel):
    accepted: int
    task_ids: list[str]
    request_id: str
