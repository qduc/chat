# Tech Stack

## Frontend
- Next.js (App Router), React 19
- State: Local React state (TanStack Query not yet added)
- UI: Tailwind CSS v4 (no shadcn yet)
- Streaming: fetch + ReadableStream manual SSE parse

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
- Backend image: Node 20 alpine, prod deps only
- Frontend image: multi-stage; build arg `NEXT_PUBLIC_API_BASE`
- Secrets: only backend receives provider key via env file (not baked)

## LLM Providers (OpenAI-compatible)
- OPENAI_BASE_URL: `https://api.openai.com/v1` (or: OpenRouter, vLLM, llamafile, etc.)
- Models: `gpt-4.1-mini` (cheap/dev), `gpt-4.1` (prod), swap freely via env
- Why compatibility: standard payloads, minimal vendor lock at API level
