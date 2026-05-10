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
