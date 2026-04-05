from app.db.base import SessionLocal
from app.models.dead_letter import DeadLetterEvent


def test_ingest_events_and_stats(client):
    response = client.post(
        "/events",
        json={
            "events": [
                {"event_id": "evt-1", "category": "orders", "payload": {"amount": 25}},
                {"event_id": "evt-2", "category": "orders", "payload": {"amount": 90}},
                {"event_id": "evt-3", "category": "payments", "payload": {"amount": 12}},
            ]
        },
    )

    assert response.status_code == 202
    body = response.json()
    assert body["accepted"] == 3
    assert len(body["task_ids"]) == 3
    assert body["request_id"]

    stats_response = client.get("/stats")
    assert stats_response.status_code == 200
    stats = stats_response.json()
    assert stats["total_events"] == 3
    assert stats["top_categories"][0]["category"] == "orders"
    assert stats["top_categories"][0]["count"] == 2


def test_failed_event_goes_to_dead_letter(client):
    response = client.post(
        "/events",
        json={
            "events": [
                {
                    "event_id": "evt-fail",
                    "category": "alerts",
                    "payload": {"force_fail": True},
                }
            ]
        },
    )

    assert response.status_code == 202

    with SessionLocal() as session:
        dead_letter_count = session.query(DeadLetterEvent).count()

    assert dead_letter_count == 1

    stats_response = client.get("/stats")
    assert stats_response.status_code == 200
    stats = stats_response.json()
    assert stats["total_events"] == 1
