Copilot Quick Guide

Purpose
- Minimal instructions to get a coding assistant productive in this repo: a Next.js frontend + Node backend that proxies OpenAI‑style chat completions and preserves streaming.

Quick flow
- Browser → `NEXT_PUBLIC_API_BASE` (default `/api`) → Next.js rewrite → Backend `/v1/chat/completions` → Provider. Preserve `Content-Type: text/event-stream` and the final `data: [DONE]` chunk.

Must‑know files
- Frontend: `frontend/lib/chat.ts`, `frontend/components/Chat.tsx`, `frontend/next.config.ts`.
- Backend: `backend/src/lib/openaiProxy.js`, `backend/src/routes/chat.js`, `backend/src/index.js`, `backend/src/middleware/rateLimit.js`.

Key envs
- Backend: `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `DEFAULT_MODEL`, `PORT`, `ALLOWED_ORIGIN`.
- Frontend: `NEXT_PUBLIC_API_BASE` (default `/api`), `BACKEND_ORIGIN`.

Invariants
- Do not expose provider keys to the browser.
- Keep OpenAI request/response schema compatible.
- Stream passthrough: forward SSE chunks unchanged; client expects `data: [DONE]` terminator.
- Apply `rateLimit` to new backend endpoints.

Local run (short)
```bash
cp backend/.env.example backend/.env && npm --prefix backend install && npm --prefix backend run dev
cp frontend/.env.example frontend/.env.local && npm --prefix frontend install && npm --prefix frontend run dev
```

Gotchas
- Dev compose ports differ (frontend `:3003`, backend `:4001`).
- Changing `BACKEND_ORIGIN` requires a Next.js server restart.

More details
- Full docs live in `docs/` (see `docs/OVERVIEW.md`, `docs/API-SPECS.md`, `docs/SECURITY.md`).
