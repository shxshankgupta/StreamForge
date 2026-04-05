import time
from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
logger = get_logger(__name__)


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.database_url,
    future=True,
    pool_pre_ping=True,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def initialize_database() -> None:
    from app.models.dead_letter import DeadLetterEvent
    from app.models.event import ProcessedEvent

    deadline = time.time() + settings.db_connect_timeout_seconds
    last_error: Exception | None = None

    while time.time() < deadline:
        try:
            with engine.begin() as connection:
                connection.execute(text("SELECT 1"))
            break
        except Exception as exc:  # pragma: no cover - exercised in Docker startup
            last_error = exc
            logger.warning("database_not_ready", extra={"error": str(exc)})
            time.sleep(1)
    else:
        raise RuntimeError("Database connection timed out") from last_error

    Base.metadata.create_all(bind=engine, tables=[ProcessedEvent.__table__, DeadLetterEvent.__table__])
