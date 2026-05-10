#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE:-cortai@ec2-35-183-30-14.ca-central-1.compute.amazonaws.com}"
REMOTE_DIR="${REMOTE_DIR:-/opt/cortai}"

rsync -az --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude ".next" \
  --exclude ".venv" \
  ./ "${REMOTE}:${REMOTE_DIR}/"

ssh "${REMOTE}" bash <<'REMOTE_SCRIPT'
set -euo pipefail
cd /opt/cortai/apps/cortai-api
uv sync
uv run alembic upgrade head

cd /opt/cortai/apps/cortai-frontend
npm ci
npm run build

sudo systemctl daemon-reload
sudo systemctl restart cortai-api cortai-frontend
sudo systemctl status --no-pager cortai-api cortai-frontend
REMOTE_SCRIPT
