import os

import pytest
from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = "sqlite:////tmp/streamforge-test.db"
os.environ["REDIS_ENABLED"] = "false"
os.environ["CELERY_TASK_ALWAYS_EAGER"] = "true"
os.environ["DB_CONNECT_TIMEOUT_SECONDS"] = "2"


@pytest.fixture()
def reset_db() -> None:
    from app.db.base import SessionLocal, initialize_database
    from app.models.dead_letter import DeadLetterEvent
    from app.models.event import ProcessedEvent

    initialize_database()
    with SessionLocal() as session:
        session.query(DeadLetterEvent).delete()
        session.query(ProcessedEvent).delete()
        session.commit()


@pytest.fixture()
def client(reset_db) -> TestClient:
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
