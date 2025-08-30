# AI Onboarding (ChatForge)

Audience: AI coding agents contributing autonomously to this repository.
Goal: Make minimal, correct changes that improve the app while preserving OpenAI‑compatible behavior and streaming.

1) Project Snapshot
- Name: ChatForge (full‑stack AI chat)
- Frontend: Next.js 15 + React 19 (TypeScript) with enhanced UI components
- Backend: Node.js (Express, ESM) acting as an OpenAI‑compatible proxy with tool orchestration
- Streaming: End‑to‑end SSE for chat responses with tool events and thinking support
- Status: MVP complete; tool orchestration system complete; testing infrastructure in place; conversation persistence in development

2) Core Principles
- Keep diffs small, focused, and documented.
- Maintain OpenAI API compatibility at the proxy boundary.
- Prefer minimal, incremental refactors over large rewrites.
- Respect existing behavior for streaming and model selection.
- Update docs when changing behavior (README.md, docs/*).

3) Repository Map
- frontend/: Next.js app (app/, components/, lib/, hooks/, contexts/)
- backend/: Express proxy (src/routes/, src/lib/, src/db/)
  - src/lib/tools.js: Server-side tool registry and execution
  - src/lib/unifiedToolOrchestrator.js: Unified tool orchestration system
  - src/lib/iterativeOrchestrator.js: Iterative workflows with thinking support
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
Note: Dev compose includes hot reload and development dependencies with Turbopack for faster iteration.

5) Environment/Secrets
- backend/.env requires OPENAI_API_KEY (or provider‑compatible key)
- Never hardcode secrets; do not log keys; keep .env local

6) API Contract (must preserve)
- POST /v1/responses → primary endpoint with conversation continuity support
- POST /v1/chat/completions → OpenAI‑compatible endpoint for compatibility
- Supports text/event-stream (SSE) for streaming tokens and tool events
- Backend injects Authorization header from server env
- Do not break request/response JSON shape or streaming semantics
- Responses API includes `previous_response_id` for conversation linking
- Tool support: tools array enables server-side tool execution with iterative workflows
- Research mode: `research_mode: true` enables multi-step tool orchestration with thinking

7) Streaming Expectations
- Frontend consumes SSE and renders partial chunks progressively
- Backend must flush tokens promptly; no buffering of full responses
- Abort support: requests should be cancellable
- Tool events: streaming includes tool_calls, tool_output events for real-time feedback
- Thinking support: iterative orchestration streams AI reasoning between tool calls

8) Rate Limiting & Safety
- In‑memory per‑IP rate limit in backend (keep or improve without regressions)
- Avoid noisy logs and PII; follow docs/SECURITY.md guidance

9) Tool Orchestration System (Major Feature)
- **Server-side tools**: Available tools defined in backend/src/lib/tools.js (get_time, web_search)
- **Unified orchestrator**: unifiedToolOrchestrator.js automatically adapts streaming/non-streaming
- **Iterative mode**: iterativeOrchestrator.js supports thinking between tool calls (up to 10 iterations)
- **Tool execution**: Tools execute server-side with proper error handling and timeouts
- **Streaming events**: Real-time tool_calls and tool_output events for UI feedback
- **Research mode**: When enabled, AI can use tools multiple times with reasoning between calls
- **Tool adding**: Add new tools with Zod validation schemas; they're automatically available
- **Persistence integration**: Tool results are properly stored in conversation history

10) Coding Standards
- Use TypeScript/ESM defaults already present
- Follow existing ESLint/Prettier configuration (backend and frontend configured)
- Run linting: `npm --prefix backend run lint` and `npm --prefix frontend run lint`
- Prefer small pure functions; handle errors and edge cases explicitly
- Maintain strong typing at API boundaries
- Tool development: Add tools to backend/src/lib/tools.js with proper validation schemas

11) Tests
- Comprehensive Jest testing infrastructure for both backend and frontend
- Tests located under package‑local __tests__/ directories
- Run tests: `npm --prefix backend test` and `npm --prefix frontend test`
- Ensure existing behavior remains green; all tests must pass
- Tool orchestration tests: iterative_orchestration.test.js, unified_tool_system.test.ts
- Frontend integration tests for enhanced UI components and chat state management

12) Performance & UX
- Preserve fast first token time; avoid unnecessary awaits in hot paths
- Keep UI responsive during streams; don't block the main thread
- Tool orchestration: up to 10 iterations with smart timeout management (30s per request)
- Quality controls: UI includes quality slider (quick/balanced/thorough) for response control
- Enhanced components: floating UI positioning with @floating-ui/react for dropdowns

13) Making Changes
- Seek the smallest viable fix; avoid broad API surface changes
- If API surface must change, keep OpenAI compatibility and update docs
- Add comments near non‑obvious logic; update README/docs links as needed

14) Useful Docs
- docs/OVERVIEW.md (architecture with current tech stack)
- docs/API-SPECS.md (both Responses API and Chat Completions API with tool support)
- docs/PROGRESS.md (development progress and completed features including tool orchestration)
- docs/TECH-STACK.md (current dependencies and infrastructure including Next.js 15, React 19)
- docs/SECURITY.md (security considerations and environment setup)
- README.md (quick start, build, testing, and tool development)
- backend/src/lib/tools.js (server-side tool registry and examples)

15) Definition of Done (for AI agents)
- Requirement satisfied with minimal diff
- Streaming and API compatibility intact (including tool events)
- No secrets leaked; local/dev still runs per README
- Relevant docs updated when behavior changes
- Tool orchestration behavior preserved when modifying tool-related code
- Enhanced UI components maintain accessibility and responsive design

Welcome aboard. Optimize for correctness, compatibility, and small, reviewable changes.