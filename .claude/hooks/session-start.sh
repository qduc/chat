#!/bin/bash
# Cloud-session setup: Docker (./dev.sh) isn't available there, so run natively.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 HUSKY=0

# Backend config: dev defaults, DB + uploads kept outside the repo
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  mkdir -p /tmp/chatforge-data
  cat >> backend/.env <<ENV

DB_URL=file:/tmp/chatforge-data/dev.db
IMAGE_STORAGE_PATH=/tmp/chatforge-data/images
PERSIST_TRANSCRIPTS=1
ENV
fi

# npm install (not ci) so the cached container state is reused
(cd backend && npm install --no-audit --no-fund)
(cd frontend && npm install --no-audit --no-fund)

# Idempotent; creates the SQLite DB if missing
(cd backend && npm run migrate up)
