#!/usr/bin/env bash
set -euo pipefail

# Ensure we run from repo root regardless of current dir
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$REPO_ROOT"

# 1) Ensure backend .env exists by copying example if missing
if [ ! -f backend/.env ]; then
  if [ -f backend/.env.example ]; then
    cp backend/.env.example backend/.env
    echo "Created backend/.env from example. Remember to set OPENAI_API_KEY, etc."
  else
    echo "Warning: backend/.env.example not found; create backend/.env manually." >&2
  fi
fi

# 2) Ensure frontend .env.local exists by copying example if present
if [ ! -f frontend/.env.local ] && [ -f frontend/.env.example ]; then
  cp frontend/.env.example frontend/.env.local
  echo "Created frontend/.env.local from example."
fi

# 3) Install deps (faster on subsequent runs because of volume caches)
if [ -f backend/package.json ]; then
  npm --prefix backend install
fi
if [ -f frontend/package.json ]; then
  npm --prefix frontend install
fi

# 4) Print quick tips
cat <<'EOT'
Dev container init complete.
- Compose services: backend (:4001), frontend (:3003), postgres (:5432)
- VS Code terminal is attached to the 'workspace' container at /workspace
- Source is mounted; hot reload works in both Next.js and backend

Common commands:
  npm --prefix backend run dev
  npm --prefix frontend run dev

If ports aren't visible, use: Ports view -> Forward 3003 and 4001
EOT
