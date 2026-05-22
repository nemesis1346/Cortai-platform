#!/usr/bin/env bash
set -euo pipefail

# CI-friendly load check for NFR-PERF-02:
# - Starts a local Mosquitto broker (no TLS) on 1883
# - Runs simulator for 10 devices @ 100 msg/s
# - Fails if throughput is below a threshold

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
EDGE_DIR="${ROOT_DIR}/apps/edge-ingest"

MOSQUITTO_PID=""
MOSQUITTO_LOG=""
MOSQUITTO_CFG=""
cleanup() {
  if [[ -n "${MOSQUITTO_LOG}" && -f "${MOSQUITTO_LOG}" ]]; then
    echo "--- mosquitto ci log ---" >&2
    cat "${MOSQUITTO_LOG}" >&2 || true
  fi
  if [[ -n "${MOSQUITTO_PID}" ]]; then
    kill "${MOSQUITTO_PID}" >/dev/null 2>&1 || true
    wait "${MOSQUITTO_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${MOSQUITTO_CFG}" && -f "${MOSQUITTO_CFG}" ]]; then
    rm -f "${MOSQUITTO_CFG}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${MOSQUITTO_LOG}" && -f "${MOSQUITTO_LOG}" ]]; then
    rm -f "${MOSQUITTO_LOG}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if ! command -v mosquitto >/dev/null 2>&1; then
  echo "mosquitto not found. Install it (e.g. apt-get install -y mosquitto) for CI load test." >&2
  exit 2
fi

# Use a non-default port to avoid conflicting with any system mosquitto service.
CI_MQTT_PORT="${CI_MQTT_PORT:-18883}"

MOSQUITTO_LOG="$(mktemp)"

# Start a minimal plaintext broker without a config file.
# This avoids OS confinement (e.g. AppArmor) blocking reads of arbitrary config paths.
mosquitto -p "${CI_MQTT_PORT}" >"${MOSQUITTO_LOG}" 2>&1 &
MOSQUITTO_PID="$!"

# Give broker a moment to start.
sleep 0.3
if ! kill -0 "${MOSQUITTO_PID}" >/dev/null 2>&1; then
  echo "mosquitto failed to start (see log above)" >&2
  exit 3
fi

cd "${EDGE_DIR}"

# Default: require at least 95 msg/s achieved to tolerate minor jitter.
MIN_ACHIEVED_MPS="${MIN_ACHIEVED_MPS:-95}"

uv run python -m edge_ingest.simulator \
  --insecure-no-tls \
  --host 127.0.0.1 --port "${CI_MQTT_PORT}" \
  --org ci --property ci \
  --devices 10 --rate 100 --duration-s 10 \
  --types health \
  --qos 0 --backend paho \
  --min-achieved-mps "${MIN_ACHIEVED_MPS}"

