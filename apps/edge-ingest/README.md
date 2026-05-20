# edge-ingest (DE-03)

Async ingestion service that subscribes to the Mosquitto broker, validates the DE-02 envelope, applies RLS context, and persists messages into `iot.*` hypertables.

## Local run (example)

```bash
cd apps/edge-ingest
cp .env.example .env
uv sync
uv run python -m edge_ingest.main
```

