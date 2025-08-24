# AI Onboarding (ChatForge)

Audience: AI coding agents contributing autonomously to this repository.
Goal: Make minimal, correct changes that improve the app while preserving OpenAI‑compatible behavior and streaming.

1) Project Snapshot
- Name: ChatForge (full‑stack AI chat)
- Frontend: Next.js + React (TypeScript)
- Backend: Node.js (Express, ESM) acting as an OpenAI‑compatible proxy
- Streaming: End‑to‑end SSE for chat responses
- Status: MVP complete; testing infrastructure in place; conversation persistence in development

2) Core Principles
- Keep diffs small, focused, and documented.
- Maintain OpenAI API compatibility at the proxy boundary.
- Prefer minimal, incremental refactors over large rewrites.
- Respect existing behavior for streaming and model selection.
- Update docs when changing behavior (README.md, docs/*).

3) Repository Map
- frontend/: Next.js app (app/, components/, lib/)
- backend/: Express proxy (src/routes/, src/lib/, src/db/)
- docs/: Overview/specs/progress/security
- docker-compose*.yml, dev.sh: Dev orchestration

4) How to Run (dev)
Option A: Local Node (from README)
- Backend: cp backend/.env.example backend/.env; npm --prefix backend install; npm --prefix backend run dev (http://localhost:3001)
- Frontend: cp frontend/.env.example frontend/.env.local; npm --prefix frontend install; npm --prefix frontend run dev (http://localhost:3000)
Option B: Docker Production
- docker compose -f docker-compose.yml up --build (frontend on 3000)
Option C: Docker Development (with hot reload)
- docker compose -f docker-compose.dev.yml up --build (frontend on 3000)
Note: Dev compose includes hot reload and development dependencies.

5) Environment/Secrets
- backend/.env requires OPENAI_API_KEY (or provider‑compatible key)
- Never hardcode secrets; do not log keys; keep .env local

6) API Contract (must preserve)
- POST /v1/responses → primary endpoint with conversation continuity support
- POST /v1/chat/completions → OpenAI‑compatible endpoint for compatibility
- Supports text/event-stream (SSE) for streaming tokens
- Backend injects Authorization header from server env
- Do not break request/response JSON shape or streaming semantics
- Responses API includes `previous_response_id` for conversation linking

7) Streaming Expectations
- Frontend consumes SSE and renders partial chunks progressively
- Backend must flush tokens promptly; no buffering of full responses
- Abort support: requests should be cancellable

8) Rate Limiting & Safety
- In‑memory per‑IP rate limit in backend (keep or improve without regressions)
- Avoid noisy logs and PII; follow docs/SECURITY.md guidance

9) Coding Standards
- Use TypeScript/ESM defaults already present
- Follow existing ESLint/Prettier configuration (backend and frontend configured)
- Run linting: `npm --prefix backend run lint` and `npm --prefix frontend run lint`
- Prefer small pure functions; handle errors and edge cases explicitly
- Maintain strong typing at API boundaries

10) Tests
- Comprehensive Jest testing infrastructure for both backend and frontend
- Tests located under package‑local __tests__/ directories
- Run tests: `npm --prefix backend test` and `npm --prefix frontend test`
- Ensure existing behavior remains green; all tests must pass

11) Performance & UX
- Preserve fast first token time; avoid unnecessary awaits in hot paths
- Keep UI responsive during streams; don’t block the main thread

12) Making Changes
- Seek the smallest viable fix; avoid broad API surface changes
- If API surface must change, keep OpenAI compatibility and update docs
- Add comments near non‑obvious logic; update README/docs links as needed

13) Useful Docs
- docs/OVERVIEW.md (architecture with current tech stack)
- docs/API-SPECS.md (both Responses API and Chat Completions API)
- docs/CONVERSATIONS-SPEC.md (conversation persistence specification)
- docs/PROGRESS.md (development progress and completed features)
- docs/TECH-STACK.md (current dependencies and infrastructure)
- docs/SECURITY.md (security considerations and environment setup)
- README.md (quick start, build, and testing)

14) Definition of Done (for AI agents)
- Requirement satisfied with minimal diff
- Streaming and API compatibility intact
- No secrets leaked; local/dev still runs per README
- Relevant docs updated when behavior changes

Welcome aboard. Optimize for correctness, compatibility, and small, reviewable changes.