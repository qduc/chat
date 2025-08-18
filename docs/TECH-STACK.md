# Tech Stack

## Frontend
- Next.js (App Router) — project `frontend/package.json` lists `next@15.x`.
- React: `react@19.x` as listed in `frontend/package.json`.
- State: Local React state (TanStack Query not yet added).
- UI: Tailwind CSS (project uses Tailwind v4 in dev deps).
- Streaming: `fetch` + ReadableStream manual SSE parse (implemented in `frontend/lib/chat.ts`).

## Backend
- Node 20 + Express (JS, ESM)
- SSE passthrough for /v1/chat/completions (done)
- Rate limiting: in-memory (Redis planned)
- Auth: none (JWT/API key phase 3)

## Infra (MVP)
- Dockerized (frontend + backend via `docker-compose.yml`)
- Future: Postgres (sessions/transcripts), Redis (rate limit)
- Logging: morgan (pino later); metrics planned (Prometheus)

### Container Notes
- Backend image: Node 20 alpine, prod deps only (`backend/Dockerfile`).
- Frontend image: multi-stage; build args `NEXT_PUBLIC_API_BASE` and `BACKEND_ORIGIN` are supported (`frontend/Dockerfile`).
- Secrets: only backend receives provider key via env file (do not bake keys into images).

## LLM Providers (OpenAI-compatible)
- `OPENAI_BASE_URL` defaults to `https://api.openai.com/v1` in `backend/.env.example` but can point to any OpenAI-compatible provider.
- Default model is `gpt-4.1-mini` (see `backend/.env.example` / `DEFAULT_MODEL`).
- Why compatibility: standard payloads, minimal vendor lock at API level.
