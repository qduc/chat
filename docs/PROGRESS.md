# Progress Log

## 2025-08-13
### Done
- Scaffolded docs and repo
- Chose Next.js + Express
- Drafted API contract for /v1/chat/completions (streaming)
- Implemented backend proxy with streaming SSE passthrough
- Added rate limiting middleware (in-memory MVP)
- Bootstrapped Next.js frontend
- Implemented streaming chat UI (model select, stop, keyboard shortcuts)

### Blockers
- None (persistence & auth intentionally deferred)

### Next (Short-term)
- Persist conversations (localStorage → DB later)
- Add system prompt & temperature controls
- Error & retry UX polish; token usage display

### Upcoming (Mid-term)
- Multi-model routing abstraction
- Auth (API keys / session) & per-user rate limits
- Observability (logging improvements, metrics)

## 2025-08-18
### Done
- Added explicit `dev` stages to `backend/Dockerfile` and `frontend/Dockerfile`.
- Updated `docker-compose.dev.yml` to target the `dev` stages, use `/api` with `BACKEND_ORIGIN` for rewrites, and improve file watching.

### Notes
- Production builds remain unchanged; `docker-compose.yml` continues to use the prod image flow.
- Dev containers now avoid pruning devDependencies and skip prod build steps for faster iteration.
