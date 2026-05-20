from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # In production we rely on systemd `EnvironmentFile=` to load `/opt/cortai/apps/edge-ingest/.env`
    # and do NOT re-read the .env file from Python (avoids permission/race issues).
    model_config = SettingsConfigDict(extra="ignore")

    environment: str = "local"
    database_url: str = Field(default="postgresql://cortai_app:cortai_app@localhost:5432/cortai")

    mqtt_host: str = "127.0.0.1"
    mqtt_port: int = 8883
    mqtt_topic: str = "cortai/+/+/edge/+/+"
    mqtt_client_id: str = "cortai-edge-ingest"

    mqtt_ca_file: str = "/etc/cortai/mosquitto/certs/ca.crt"
    mqtt_client_cert: str = ""
    mqtt_client_key: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()

