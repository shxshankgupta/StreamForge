from datetime import datetime, timedelta, timezone

from app.db.base import SessionLocal, initialize_database
from app.models.event import ProcessedEvent
from app.services.analytics import get_stats_payload


def test_get_stats_payload_returns_totals(reset_db):
    initialize_database()

    now = datetime.now(timezone.utc)
    with SessionLocal() as session:
        session.add_all(
            [
                ProcessedEvent(
                    source_event_id="unit-1",
                    category="orders",
                    status="processed",
                    payload={},
                    result={},
                    occurred_at=now,
                    processed_at=now,
                ),
                ProcessedEvent(
                    source_event_id="unit-2",
                    category="payments",
                    status="processed",
                    payload={},
                    result={},
                    occurred_at=now - timedelta(seconds=10),
                    processed_at=now - timedelta(seconds=10),
                ),
            ]
        )
        session.commit()

        payload = get_stats_payload(session)

    assert payload["total_events"] >= 2
    assert payload["events_per_second"] >= 0
    assert any(item["category"] == "orders" for item in payload["top_categories"])
