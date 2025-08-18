# Copilot Instructions for This Repo

Purpose: Make AI coding agents immediately productive in this codebase by explaining architecture, workflows, and house rules.

## Big picture
- App: Full‑stack chat UI that talks to an OpenAI‑compatible API through our backend proxy.
- Frontend: Next.js (App Router) + React, streaming UI, minimal state. Default API base is `NEXT_PUBLIC_API_BASE` (defaults to `/api`). See `frontend/lib/chat.ts` and `frontend/components/Chat.tsx`.
- Backend: Node 20 + Express ESM proxy that forwards `/v1/chat/completions` to `OPENAI_BASE_URL/chat/completions`, injects `Authorization`, and preserves streaming (SSE passthrough). See `backend/src/lib/openaiProxy.js` and `backend/src/routes/chat.js`.
- Why this shape: Keep provider keys server‑side, standardize on OpenAI schema, and enable the UI to stream tokens with low coupling.

## How the pieces talk
- Browser → Frontend server: calls `${NEXT_PUBLIC_API_BASE}/v1/chat/completions` (default `/api/...`).
- Frontend server → Backend: Next.js rewrites map `/api/:path*` → `${BACKEND_ORIGIN}/:path*` at runtime. See `frontend/next.config.ts`.
- Backend → Provider: POST `${OPENAI_BASE_URL}/chat/completions` with the original JSON body; if `stream=true`, response is `text/event-stream` and we pass chunks through unchanged.

## Local workflows
- Pure Node dev:
  - Backend: `cp backend/.env.example backend/.env && npm --prefix backend install && npm --prefix backend run dev` (listens on `:3001`).
  - Frontend: `cp frontend/.env.example frontend/.env.local && npm --prefix frontend install && npm --prefix frontend run dev` (visits `:3000`).
- Docker (prod‑like): `docker compose -f docker-compose.yml up --build` (frontend `:3000`, backend `:3001`).
- Docker (live dev): `./dev.sh up --build` using `docker-compose.dev.yml` (frontend `:3003`, backend `:4001`).

## Environment and routing
- Backend required env (see `backend/.env.example`): `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `DEFAULT_MODEL`, `PORT`, `RATE_LIMIT_*`, `ALLOWED_ORIGIN`. Loaded via `backend/src/env.js` (ESM; warns if missing).
- Frontend env (see `frontend/.env.example`): `NEXT_PUBLIC_API_BASE` (default `/api`), `BACKEND_ORIGIN` (default `http://localhost:3001` in local; `http://backend:3001` in Compose). Rewrites use `BACKEND_ORIGIN` if it’s an absolute URL; otherwise fall back to `http://localhost:3001`.

## Key patterns to follow
- Streaming protocol: Frontend manually parses SSE lines like `data: { ... }` and a final `data: [DONE]`. See `frontend/lib/chat.ts` → `sendChat`.
- UI model selection: `components/Chat.tsx` sets `model` and passes it through to `sendChat`; backend will default to `config.defaultModel` if omitted.
- Rate limiting: Simple in‑memory per‑IP middleware (`backend/src/middleware/rateLimit.js`). If you add new endpoints, ensure `rateLimit` applies.
- Error handling:
  - Backend: top‑level error handler returns `{ error: 'internal_server_error' }` with 500.
  - Frontend: `sendChat` throws on non‑OK and tries to surface JSON `{ error | message }`.

## Extending safely
- New backend route: add a router under `backend/src/routes/` and `app.use(...)` in `backend/src/index.js`. Keep payloads OpenAI‑compatible where possible. Never expose provider keys to the browser.
- New frontend API call: target `${process.env.NEXT_PUBLIC_API_BASE || '/api'}` and rely on Next.js rewrites. Do not call provider origins from the browser.
- Streaming changes: preserve `Content-Type: text/event-stream` and write chunks unmodified; keep `[DONE]` terminator semantics.
- CORS: `ALLOWED_ORIGIN` governs `cors({ origin })` in `backend/src/index.js`; adjust if adding cross‑origin clients.

## Change management & docs
- When you make significant changes, update the docs in the same PR:
  - API shape/endpoints/streaming: `docs/API-SPECS.md`, `backend/README.md`, `frontend/README.md`.
  - Env, routing, ports, or compose changes: root `README.md` (Run It), comments in `docker-compose*.yml`, and `frontend/next.config.ts` header comment if behavior changes.
  - Security or rate limiting: `docs/SECURITY.md` and any env examples (`backend/.env.example`, `frontend/.env.example`).
  - Architecture/stack shifts: `docs/OVERVIEW.md`, `docs/TECH-STACK.md`.
  - Add a dated note to `docs/PROGRESS.md` summarizing the change and any follow‑ups.

## Files to know
- Frontend: `frontend/lib/chat.ts` (SSE client), `frontend/components/Chat.tsx` (streaming UI), `frontend/next.config.ts` (rewrites), `frontend/app/page.tsx`.
- Backend: `backend/src/lib/openaiProxy.js` (proxy logic), `backend/src/routes/chat.js`, `backend/src/index.js` (app wiring), `backend/src/env.js` (config), `backend/src/middleware/rateLimit.js`.
- Infra: `docker-compose.yml`, `docker-compose.dev.yml`, `dev.sh`.
- Docs: `docs/OVERVIEW.md`, `docs/API-SPECS.md`, `docs/SECURITY.md`, `docs/TECH-STACK.md`.

## Gotchas
- Ports differ in dev compose: frontend `:3003`, backend `:4001`. The app still calls `/api` and rewrites to the internal `backend:3001`.
- `next.config.ts` uses runtime env for rewrites; changing `BACKEND_ORIGIN` requires a server restart.
- Backend is ESM JavaScript; use `import` syntax and keep Node 20 compatibility.

If anything above is unclear or you see gaps (e.g., planned persistence/auth), ask to refine this file with concrete examples based on your task.
