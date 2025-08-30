# Backend

Express-based proxy for OpenAI-compatible chat completions, with pluggable providers.

## Endpoints

- `POST /v1/chat/completions` – proxies to `${PROVIDER_BASE_URL||OPENAI_BASE_URL}/v1/chat/completions` (supports streaming)
- `POST /v1/conversations` – create a conversation (feature-flagged)
- `GET /v1/conversations/:id` – fetch conversation metadata (feature-flagged)
- `GET /healthz` – health/status info

## Env Vars (.env)

See `.env.example` for required variables. You can select a provider via `PROVIDER` (default: `openai`). Generic keys `PROVIDER_BASE_URL`, `PROVIDER_API_KEY`, and optional `PROVIDER_HEADERS_JSON` are supported; OpenAI-specific vars remain for backward compatibility.

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

### Persistence Behavior

When `PERSIST_TRANSCRIPTS=true`, the server records conversation history with a simple, final-only strategy:

- User messages: inserted immediately at request start (based on the last user message in the request).
- Assistant messages: buffered in memory during streaming and inserted once at completion with the final content and finish reason. No per-token/delta writes.
- Errors mid-stream: an assistant error row is inserted; no final row is written afterward.

This reduces database write load and avoids timer-based flushes while preserving streaming to clients. Existing conversation routes and schema remain compatible.

## Run with Docker

1. Create env file (not copied into image):
   ```bash
   cp .env.example .env
   # edit PROVIDER/OPENAI variables as needed
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
- Add request body redaction
- Add tests
- Add graceful shutdown
- Add Docker healthcheck instruction

## Logging

Structured logging is enabled via pino.

- LOG_LEVEL: trace|debug|info|warn|error|fatal (default: debug in dev, info in prod)
- LOG_PRETTY: true|false (default: true in dev, false in prod)

Each request is assigned an x-request-id (or honors incoming x-request-id) and logs request:start and request:end with duration, status, and sessionId (from sessionResolver).

Sensitive fields like Authorization headers are redacted.
