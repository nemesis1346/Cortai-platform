#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE:-ubuntu@ec2-15-223-47-64.ca-central-1.compute.amazonaws.com}"
REMOTE_DIR="${REMOTE_DIR:-/opt/cortai}"
SSH_IDENTITY="${SSH_IDENTITY:-}"

if [[ -z "${SSH_IDENTITY}" && -f "./deploy/cortai.pem" ]]; then
  SSH_IDENTITY="./deploy/cortai.pem"
fi

SSH_OPTS=()
if [[ -n "${SSH_IDENTITY}" ]]; then
  SSH_OPTS+=(-i "${SSH_IDENTITY}" -o IdentitiesOnly=yes)
fi

RSYNC_SSH_CMD="ssh"
if [[ ${#SSH_OPTS[@]} -gt 0 ]]; then
  RSYNC_SSH_CMD="ssh ${SSH_OPTS[*]}"
fi

if [[ ${#SSH_OPTS[@]} -gt 0 ]]; then
  rsync -az --delete -e "${RSYNC_SSH_CMD}" \
    --exclude ".env" \
    --exclude ".env.*" \
    --exclude ".git" \
    --exclude "node_modules" \
    --exclude ".next" \
    --exclude ".venv" \
    --exclude "secrets" \
    --exclude "deploy/mosquitto/certs" \
    ./ "${REMOTE}:${REMOTE_DIR}/"
else
  rsync -az --delete \
    --exclude ".env" \
    --exclude ".env.*" \
    --exclude ".git" \
    --exclude "node_modules" \
    --exclude ".next" \
    --exclude ".venv" \
    --exclude "secrets" \
    --exclude "deploy/mosquitto/certs" \
    ./ "${REMOTE}:${REMOTE_DIR}/"
fi

ssh "${SSH_OPTS[@]}" "${REMOTE}" bash <<'REMOTE_SCRIPT'
set -euo pipefail

# Ensure user-level installs are available in non-interactive shells
export PATH="$HOME/.local/bin:$PATH"

if ! command -v uv >/dev/null 2>&1; then
  echo "ERROR: uv not found on remote host."
  echo "Install it (one-time) with:"
  echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
  echo "Then re-run deploy."
  exit 1
fi

cd /opt/cortai/apps/cortai-api
uv sync
uv run alembic upgrade head

# edge-ingest
cd /opt/cortai/apps/edge-ingest
uv sync

# Avoid serving mixed Next.js assets during rebuilds
sudo systemctl stop cortai-frontend || true
# Always bring the frontend back up, even if a later step fails.
trap 'sudo systemctl start cortai-frontend || true' EXIT

cd /opt/cortai/apps/cortai-frontend
npm ci
rm -rf .next
npm run build

# Next.js standalone expects static/public copied alongside server.js
mkdir -p .next/standalone/.next
rm -rf .next/standalone/.next/static
cp -r .next/static .next/standalone/.next/static
rm -rf .next/standalone/public
cp -r public .next/standalone/public

# Ensure systemd uses the updated unit files from the repo
sudo cp -f /opt/cortai/deploy/systemd/cortai-api.service /etc/systemd/system/cortai-api.service
sudo cp -f /opt/cortai/deploy/systemd/cortai-frontend.service /etc/systemd/system/cortai-frontend.service
if [[ -f /opt/cortai/deploy/systemd/cortai-device-offline-sweeper.service ]]; then
  sudo cp -f /opt/cortai/deploy/systemd/cortai-device-offline-sweeper.service /etc/systemd/system/cortai-device-offline-sweeper.service
fi
if [[ -f /opt/cortai/deploy/systemd/cortai-device-offline-sweeper.timer ]]; then
  sudo cp -f /opt/cortai/deploy/systemd/cortai-device-offline-sweeper.timer /etc/systemd/system/cortai-device-offline-sweeper.timer
fi
if [[ -f /opt/cortai/deploy/systemd/cortai-mqtt.service ]]; then
  sudo cp -f /opt/cortai/deploy/systemd/cortai-mqtt.service /etc/systemd/system/cortai-mqtt.service
fi
if [[ -f /opt/cortai/deploy/systemd/cortai-edge-ingest.service ]]; then
  sudo cp -f /opt/cortai/deploy/systemd/cortai-edge-ingest.service /etc/systemd/system/cortai-edge-ingest.service
fi
if [[ -f /opt/cortai/deploy/systemd/journald.conf.d/cortai.conf ]]; then
  sudo mkdir -p /etc/systemd/journald.conf.d
  sudo cp -f /opt/cortai/deploy/systemd/journald.conf.d/cortai.conf /etc/systemd/journald.conf.d/cortai.conf
  sudo systemctl restart systemd-journald
fi
if [[ -f /opt/cortai/deploy/Caddyfile ]]; then
  sudo cp -f /opt/cortai/deploy/Caddyfile /etc/caddy/Caddyfile
  sudo caddy fmt --overwrite /etc/caddy/Caddyfile || true
  sudo systemctl reload caddy || sudo systemctl restart caddy
fi

sudo systemctl daemon-reload
sudo systemctl restart cortai-api cortai-frontend
if systemctl list-unit-files | grep -q '^cortai-device-offline-sweeper\.timer'; then
  sudo systemctl enable --now cortai-device-offline-sweeper.timer
fi
if systemctl list-unit-files | grep -q '^cortai-mqtt\.service'; then
  sudo systemctl restart cortai-mqtt || true
fi
if systemctl list-unit-files | grep -q '^cortai-edge-ingest\.service'; then
  sudo systemctl restart cortai-edge-ingest || true
fi
sudo systemctl status --no-pager cortai-api cortai-frontend || true
if systemctl list-unit-files | grep -q '^cortai-device-offline-sweeper\.timer'; then
  sudo systemctl status --no-pager cortai-device-offline-sweeper.timer || true
fi
if systemctl list-unit-files | grep -q '^cortai-mqtt\.service'; then
  sudo systemctl status --no-pager cortai-mqtt || true
fi
if systemctl list-unit-files | grep -q '^cortai-edge-ingest\.service'; then
  sudo systemctl status --no-pager cortai-edge-ingest || true
fi
REMOTE_SCRIPT
