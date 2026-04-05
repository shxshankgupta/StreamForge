from datetime import datetime, timezone
from typing import Any

from celery.signals import worker_process_init

from app.core.celery_app import celery_app
from app.core.logging import configure_logging, get_logger
from app.db.base import SessionLocal, initialize_database
from app.models.dead_letter import DeadLetterEvent
from app.models.event import ProcessedEvent
from app.services.analytics import publish_stats_update

configure_logging()
logger = get_logger(__name__)


@worker_process_init.connect
def bootstrap_worker(**_: Any) -> None:
    initialize_database()


def _build_processing_result(event: dict[str, Any]) -> dict[str, Any]:
    payload = event.get("payload", {})
    payload_size = len(str(payload))
    checksum = sum(ord(char) for char in str(payload)) % 9973

    if payload.get("force_fail"):
        raise ValueError("Forced failure requested by payload")

    return {
        "normalized_category": event["category"],
        "payload_size": payload_size,
        "checksum": checksum,
        "processed_at": datetime.now(timezone.utc).isoformat(),
    }


def _store_processed_event(event: dict[str, Any], status: str, result: dict[str, Any]) -> None:
    with SessionLocal() as session:
        record = ProcessedEvent(
            source_event_id=event["event_id"],
            category=event["category"],
            status=status,
            payload=event.get("payload", {}),
            result=result,
            occurred_at=datetime.fromisoformat(event["occurred_at"]),
            processed_at=datetime.now(timezone.utc),
        )
        session.add(record)
        session.commit()
        publish_stats_update(session)


def _store_dead_letter(event: dict[str, Any], error_message: str) -> None:
    with SessionLocal() as session:
        failed_record = ProcessedEvent(
            source_event_id=event["event_id"],
            category=event["category"],
            status="failed",
            payload=event.get("payload", {}),
            result={"error": error_message},
            occurred_at=datetime.fromisoformat(event["occurred_at"]),
            processed_at=datetime.now(timezone.utc),
        )
        session.add(failed_record)
        session.add(
            DeadLetterEvent(
                source_event_id=event["event_id"],
                category=event["category"],
                payload=event.get("payload", {}),
                error_message=error_message,
            )
        )
        session.commit()
        publish_stats_update(session)


@celery_app.task(bind=True, max_retries=3, name="streamforge.process_event")
def process_event(self, event: dict[str, Any]) -> dict[str, Any]:
    try:
        result = _build_processing_result(event)
        _store_processed_event(event, "processed", result)
        logger.info("event_processed", extra={"task_id": self.request.id})
        return result
    except Exception as exc:
        logger.exception("event_processing_failed", extra={"task_id": self.request.id, "error": str(exc)})
        if self.request.retries >= 3:
            _store_dead_letter(event, str(exc))
            raise
        countdown = 2 ** self.request.retries
        raise self.retry(exc=exc, countdown=countdown)
