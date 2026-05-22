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
    mqtt_sub_qos: int = Field(default=1, ge=0, le=1)

    mqtt_ca_file: str = "/etc/cortai/mosquitto/certs/ca.crt"
    mqtt_client_cert: str = ""
    mqtt_client_key: str = ""

    # Performance / load-test knobs (NFR-PERF-02)
    perf_mode: bool = False
    validate_envelope: bool = True
    ingest_workers: int = Field(default=64, ge=1, le=2048)
    ingest_queue_maxsize: int = Field(default=20_000, ge=0, le=1_000_000)
    db_pool_min_size: int = Field(default=4, ge=1, le=128)
    db_pool_max_size: int = Field(default=16, ge=1, le=256)
    batch_size: int = Field(default=500, ge=1, le=50_000)
    batch_flush_ms: int = Field(default=100, ge=1, le=10_000)
    enable_live_notify: bool = True
    enable_device_last_seen: bool = True
    stats_interval_s: float = Field(default=1.0, ge=0.1, le=60.0)


@lru_cache
def get_settings() -> Settings:
    return Settings()

