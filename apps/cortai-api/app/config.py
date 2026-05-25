from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "COrtai API"
    environment: str = "local"
    database_url: str = Field(
        default="postgresql+asyncpg://cortai_app:cortai_app@localhost:5432/cortai"
    )
    # Optional dependencies used for NFR-OBS-02 health reporting.
    redis_url: str | None = None
    mqtt_host: str = "127.0.0.1"
    mqtt_port: int = 8883

    # Build metadata (best-effort; can be set by deploy/CI).
    build_sha: str | None = None
    build_version: str | None = None

    # Health endpoint should be fast for alarms.
    health_timeout_s: float = Field(default=1.5, ge=0.1, le=10.0)
    jwt_private_key: str = Field(default="")
    jwt_public_key: str = Field(default="")
    jwt_issuer: str = "cortai-api"
    jwt_audience: str = "cortai-platform"
    jwt_ttl_seconds: int = 60 * 60 * 12
    cookie_domain: str | None = None
    cors_origins: list[str] = ["http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
