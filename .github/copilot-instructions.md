# Copilot Instructions for ChatForge

## Architecture Snapshot
- ChatForge splits into `frontend/` (Next.js 15 App Router) and `backend/` (Express 5 ESM); keep responsibilities isolated when wiring features across services.
- `backend/src/index.js` enforces middleware order (session → logging → rate limit → routers); preserve this sequence when inserting new handlers.
- SSE is the default transport: `frontend/next.config.ts` disables compression to avoid buffering, so never re-enable gzip when touching Next.js config.

## Backend Patterns
- `/v1/chat/completions` always funnels through `proxyOpenAIRequest` (`backend/src/lib/openaiProxy.js`); extend sanitization, orchestration flags, or persistence there instead of patching the router.
- Tools: the UI sends tool names, `generateOpenAIToolSpecs()` expands them, and handlers live in `backend/src/lib/tools*.js`; implement both streaming (`handleToolsStreaming`) and JSON (`handleToolsJson`) paths for new tools.
- Persistence uses final-only writes via `SimplifiedPersistence`; stream paths must call `appendContent` for chunks and `recordAssistantFinal` once or persistence tests will fail.
- Providers resolve via `backend/src/lib/providers/index.js`: DB rows override env config, and the OpenAI provider flips to the Responses API automatically when the base URL targets `api.openai.com`.
- Env validation sits in `backend/src/env.js`; declare new variables there or the server will exit before listening.

## Frontend Patterns
- `useChatState` (in `frontend/hooks/useChatState.ts`) is the single reducer; always dispatch via `actions.*` returned by the hook rather than mutating state in components.
- Conversation routing is URL-driven (`ChatV2` watches `?c=`); when adding conversation-aware flows, update `actions.selectConversation` and the URL sync effects together.
- Streaming utilities live in `frontend/lib/chat/`; extend `ChatClient` and reuse the `SSEParser` for new transport logic while keeping the legacy `sendChat` wrapper intact.
- UI shells (`ChatSidebar`, `RightSidebar`, `MessageList`, `MessageInput`) expect tool events and errors shaped like the SSE parser output; align new event types with those contracts.

## Workflows & Tooling
- **All development commands must be run in Docker.** Use the `./dev.sh` helper script to manage the Docker environment and run commands without entering containers. Start the Docker dev environment with `./dev.sh up --build` to ensure consistent setup and dependencies.
- Root scripts: Use `./dev.sh test` for running all tests, `./dev.sh test:backend` for backend tests, `./dev.sh test:frontend` for frontend tests, and `./dev.sh exec backend npm run lint` for linting, which fan out via `--prefix` to each service.
- Backend tests require `NODE_OPTIONS=--experimental-vm-modules`; `./dev.sh test:backend` already sets it—mirror that when adding bespoke commands.
- Run SQLite migrations with `./dev.sh migrate [status|up|fresh]`; ensure `PERSIST_TRANSCRIPTS=true` and `DB_URL` are set or the script exits.
- Frontend dev uses Turbopack; start with `./dev.sh up --build`; API calls default to `/api` and rely on Next.js rewrites to hit the backend.
- Docker dev helper `./dev.sh up --build` exposes frontend on 3003 and backend on 4001; local Node dev is not supported—always use Docker.

## Testing Notes
- Backend integration helpers live in `backend/test_utils/`; reuse `chatProxyTestUtils` to simulate streaming/tool iterations instead of hand-rolling fetch mocks.
- Persistence changes should be exercised with `backend/__tests__/persistence/*` and `chat_proxy.persistence.test.js`.
- Frontend Jest setup is in `frontend/jest.setup.js`; register browser globals there when new components need them.
- When adjusting SSE flows, add tests under `backend/__tests__/iterative_orchestration.test.js` or `frontend/__tests__/unified_tool_system.test.ts` to cover both streaming and JSON tool paths.

## Reference Docs
- `AI_ONBOARDING.md` provides the full architecture narrative; skim it before large refactors.
- API details live in `docs/API-SPECS.md`; mirror that contract when touching routes or client SDKs.
