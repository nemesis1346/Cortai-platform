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
    --exclude ".git" \
    --exclude "node_modules" \
    --exclude ".next" \
    --exclude ".venv" \
    ./ "${REMOTE}:${REMOTE_DIR}/"
else
  rsync -az --delete \
    --exclude ".git" \
    --exclude "node_modules" \
    --exclude ".next" \
    --exclude ".venv" \
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

cd /opt/cortai/apps/cortai-frontend
npm ci
npm run build

# Next.js standalone needs static/public copied alongside server.js
mkdir -p .next/standalone/.next
rm -rf .next/standalone/.next/static
cp -r .next/static .next/standalone/.next/static
rm -rf .next/standalone/public
cp -r public .next/standalone/public

sudo systemctl daemon-reload
sudo systemctl restart cortai-api cortai-frontend
sudo systemctl status --no-pager cortai-api cortai-frontend
REMOTE_SCRIPT
