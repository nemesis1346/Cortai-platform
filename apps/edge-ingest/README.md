# edge-ingest (DE-03)

Async ingestion service that subscribes to the Mosquitto broker, validates the DE-02 envelope, applies RLS context, and persists messages into `iot.*` hypertables.

## Local run (example)

```bash
cd apps/edge-ingest
cp .env.example .env
uv sync
uv run python -m edge_ingest.main
```

## Device simulator (NFR-PERF-02)

Publishes valid DE-02 envelopes to the same MQTT topic format edge-ingest subscribes to:
`cortai/{org}/{property}/edge/{device_id}/{type}`.

Example (plain MQTT, for CI/local broker):

```bash
uv run python -m edge_ingest.simulator \
  --insecure-no-tls \
  --host 127.0.0.1 --port 1883 \
  --org demo --property demo \
  --devices 10 --rate 100 --duration-s 30 \
  --types health \
  --min-achieved-mps 95
```

Example (TLS/mTLS, if you point it at the Mosquitto 8883 listener):

```bash
uv run python -m edge_ingest.simulator \
  --host 127.0.0.1 --port 8883 \
  --org demo --property demo \
  --devices 10 --rate 100 --duration-s 30 \
  --types health \
  --ca-file /opt/cortai/secrets/edge-ingest-tls/ca.crt \
  --client-cert /opt/cortai/secrets/edge-ingest-tls/edge-0007.crt \
  --client-key /opt/cortai/secrets/edge-ingest-tls/edge-0007.key
```

Notes:
- For throughput tests (NFR-PERF-02), prefer `--qos 0` to avoid PUBACK backpressure.
- Increase `--connections` (multiple MQTT connections) if a single connection can't sustain the target rate.
- In CI, use `--min-achieved-mps` to fail the job if the runner is too slow.

### CI load test helper

If your CI runner has the `mosquitto` binary available, you can run a self-contained check:

```bash
MIN_ACHIEVED_MPS=95 ./apps/edge-ingest/scripts/ci_load_test.sh
```

