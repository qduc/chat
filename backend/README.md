# Backend

Express-based proxy for OpenAI-compatible chat completions.

## Endpoints

- `POST /v1/chat/completions` – proxies to `OPENAI_BASE_URL/chat/completions` (supports streaming)
- `POST /v1/conversations` – create a conversation (feature-flagged)
- `GET /v1/conversations/:id` – fetch conversation metadata (feature-flagged)
- `GET /healthz` – health/status info

## Env Vars (.env)

See `.env.example` for required variables.

Additional (Sprint 1):

- `PERSIST_TRANSCRIPTS` (default: false). When false, conversation endpoints return 501 and no DB writes occur.
- `DB_URL` (SQLite dev example: `file:./backend/data/dev.db`). Required when `PERSIST_TRANSCRIPTS=true`.

## Run (Dev)

```bash
cp .env.example .env
npm install
npm run dev
```

## Local dev DB (SQLite)

Set in `.env`:

```
PERSIST_TRANSCRIPTS=true
DB_URL=file:./backend/data/dev.db
```

## Run with Docker

1. Create env file (not copied into image):
   ```bash
   cp .env.example .env
   # edit OPENAI_API_KEY etc.
   ```
2. Build & run (from repo root):
   ```bash
   docker compose -f docker-compose.yml build backend
   docker compose -f docker-compose.yml up backend
   ```
3. Service listens on `localhost:3001`.

Image notes:

- Production image installs only prod deps
- Provide env at runtime (never bake secrets)
- Health check endpoint: `GET /healthz`

## Rate Limiting

Simple in-memory per-IP. Replace with Redis for production scale.

## TODO

- Replace in-memory rate limiter with Redis implementation
- Add structured logging (pino)
- Add request body redaction
- Add tests
- Add graceful shutdown
- Add Docker healthcheck instruction
