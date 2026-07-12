import asyncio
import json
from contextlib import suppress

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.db.base import SessionLocal, get_db
from app.schemas.event import EventBatchIngestRequest, EventBatchIngestResponse
from app.schemas.stats import StatsResponse
from app.services.analytics import get_stats_payload, publish_stats_update
from app.services.events import enqueue_events
from app.services.redis_client import get_pubsub

router = APIRouter()
logger = get_logger(__name__)


@router.get("/health", tags=["system"])
def healthcheck() -> dict[str, str]:
    return {"status": "ok", "service": "StreamForge"}


@router.post(
    "/events",
    response_model=EventBatchIngestResponse,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["events"],
)
def ingest_events(
    payload: EventBatchIngestRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> EventBatchIngestResponse:
    task_ids = enqueue_events(payload.events)
    logger.info("events_enqueued", extra={"count": len(task_ids)})
    publish_stats_update(db)
    return EventBatchIngestResponse(
        accepted=len(task_ids),
        task_ids=task_ids,
        request_id=request.state.request_id,
    )


@router.get("/stats", response_model=StatsResponse, tags=["analytics"])
def read_stats(db: Session = Depends(get_db)) -> StatsResponse:
    return StatsResponse(**get_stats_payload(db))


@router.get("/stats/stream", tags=["analytics"])
async def stream_stats() -> StreamingResponse:
    async def event_stream():
        with SessionLocal() as session:
            initial_payload = get_stats_payload(session)
        yield f"data: {json.dumps(initial_payload)}\n\n"

        pubsub = get_pubsub()
        if pubsub is None:
            while True:
                await asyncio.sleep(2)
                with SessionLocal() as session:
                    payload = get_stats_payload(session)
                yield f"data: {json.dumps(payload)}\n\n"

        else:
            try:
                pubsub.subscribe("streamforge:stats")
                while True:
                    message = await asyncio.to_thread(
                        pubsub.get_message,
                        ignore_subscribe_messages=True,
                        timeout=10.0,
                    )
                    if message and message.get("type") == "message":
                        yield f"data: {message['data']}\n\n"
                    else:
                        yield ": heartbeat\n\n"
            finally:
                with suppress(Exception):
                    pubsub.unsubscribe("streamforge:stats")
                with suppress(Exception):
                    pubsub.close()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
