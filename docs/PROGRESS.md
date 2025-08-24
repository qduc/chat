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

## 2025-08-18
### Done
- Added explicit `dev` stages to `backend/Dockerfile` and `frontend/Dockerfile`
- Updated `docker-compose.dev.yml` to target the `dev` stages, use `/api` with `BACKEND_ORIGIN` for rewrites, and improve file watching
- Production builds remain unchanged; `docker-compose.yml` continues to use the prod image flow
- Dev containers now avoid pruning devDependencies and skip prod build steps for faster iteration

## 2025-08-24
### Done
- Added Responses API with conversation continuity support (`previous_response_id`)
- Implemented comprehensive testing infrastructure (Jest for both backend & frontend)
- Enhanced OpenAI request handling to support both Chat Completions and Responses APIs
- Added Markdown rendering with syntax highlighting (`react-markdown`, `rehype-highlight`)
- Integrated better SQLite support with `better-sqlite3`
- Added development tooling: ESLint, Prettier configuration
- Enhanced CI configuration with cache dependency paths for subprojects
- Created AI onboarding documentation for autonomous development
- Updated streaming support with proper SSE header flushing

### Current Status
- MVP chat functionality: ✅ Complete
- Streaming SSE: ✅ Complete  
- Rate limiting: ✅ Complete (in-memory)
- Testing infrastructure: ✅ Complete
- Markdown rendering: ✅ Complete
- Development environment: ✅ Complete
- API compatibility: ✅ Complete (OpenAI-compatible)

### Next (Short-term)
- Database persistence for conversations (SQLite/Postgres)
- System prompt & temperature controls in UI
- Error & retry UX improvements
- Token usage display

### Upcoming (Mid-term)
- Multi-model routing abstraction
- Auth (API keys / session) & per-user rate limits
- Observability (logging improvements, metrics)
- File uploads & attachments support
