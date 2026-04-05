from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = Field(default="development", alias="APP_ENV")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    api_port: int = Field(default=8000, alias="API_PORT")
    frontend_port: int = Field(default=3000, alias="FRONTEND_PORT")

    database_url: str = Field(
        default="postgresql+psycopg://streamforge:streamforge@postgres:5432/streamforge",
        alias="DATABASE_URL",
    )
    redis_url: str = Field(default="redis://redis:6379/0", alias="REDIS_URL")
    redis_enabled: bool = Field(default=True, alias="REDIS_ENABLED")
    stats_cache_ttl_seconds: int = Field(default=3, alias="STATS_CACHE_TTL_SECONDS")
    stats_window_seconds: int = Field(default=60, alias="STATS_WINDOW_SECONDS")

    celery_task_always_eager: bool = Field(default=False, alias="CELERY_TASK_ALWAYS_EAGER")
    celery_result_backend: str | None = Field(default=None, alias="CELERY_RESULT_BACKEND")
    worker_concurrency: int = Field(default=4, alias="WORKER_CONCURRENCY")

    cors_origins_raw: str = Field(
        default="http://localhost:3000,http://frontend:3000",
        alias="CORS_ORIGINS",
    )
    db_connect_timeout_seconds: int = Field(default=30, alias="DB_CONNECT_TIMEOUT_SECONDS")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins_raw.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
