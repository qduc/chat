# AI Onboarding Guide

This document provides essential knowledge for AI agents to be immediately productive in this codebase.

## Project Overview

**ChatForge** is a modern chat application with a Next.js frontend and Node.js backend, acting as a feature-rich OpenAI API proxy. It supports conversation branching, server-side tool orchestration, multi-provider support, multimodal uploads, and advanced reasoning controls, all within a secure, user-scoped multi-tenant environment.

## Architecture Overview

### Service Boundaries

**Frontend**
- Next.js App Router with real-time streaming UI.
- State management via specialized controller hooks.
- Direct API calls to backend.

**Backend**
- Express API server acting as OpenAI-compatible proxy.
- SQLite for persistence with user-based data isolation.
- Server-side tool orchestration (Playwright-based WebFetch, Journal, etc.).

> **Production bundling:** The root multi-stage `Dockerfile` exports the Next.js app and copies it into the Express backend. In production, the `app` container serves both `/api` and static assets. Standalone service containers only exist in the development compose stack.

### Core Principles & Architectural Decisions

1. **User-Based Data Isolation**: All data operations are strictly scoped to authenticated users (enforced via NOT NULL `user_id` constraints).
2. **Server-Side Tool Orchestration**: Tools execute exclusively on the backend; simplified tool names are expanded to full specs before execution.
3. **OpenAI API Compatibility**: The backend maintains an OpenAI-compatible interface while adding features like prompt caching and reasoning effort controls.
4. **Conversation Snapshots**: Conversations maintain complete settings snapshots (model, provider, tools) for perfect reproducibility across edits.
5. **Real-time Streaming**: SSE-based streaming for chat and tool execution with automatic checkpoint persistence for tool outputs.
6. **Prompt Caching**: Automatic insertion of cache breakpoints (e.g., for Anthropic) to optimize costs and latency.
7. **Multimodal Integrity**: Secure image/file metadata storage with path-based access control and strict size/count validation.
8. **Conversation Branching**: Messages are pinned to specific branches; edits create new revisions while preserving original paths.
9. **Parallel Tool Execution**: Configurable concurrent tool execution with user-defined max iterations.
10. **Provider Adapters**: Automatic selection of API adapters (ChatCompletions vs Responses API) based on upstream provider URLs.
11. **Message ID Protocol**: Consistent UUID-based message IDs used across all layers.

## Development Workflow

**All development commands run in Docker via `./dev.sh`:**

### Container Management
```bash
./dev.sh up [-d] [--build]  # Start/Rebuild services
./dev.sh down               # Stop and remove containers
./dev.sh restart            # Restart all services
```

### Logs & Execution
```bash
./dev.sh logs [service]     # View logs (frontend/backend)
./dev.sh exec backend <cmd> # Execute command in backend (e.g., npm test)
```

> Warning: The `frontend` Compose dev service is configured for development and sets `NODE_ENV=development`. If you need to run a production frontend build inside the dev container, use `./dev.sh exec frontend npm run build`, which now forces `NODE_ENV=production` for the build command.

### Testing & Database
```bash
./dev.sh test[:backend|:frontend] # Run tests
./dev.sh migrate [status|up|fresh] # Manage migrations
./dev.sh exec backend sqlite3 /data/dev.db # Direct DB access
```

### Production Management
```bash
./prod.sh up                # Start production (single 'app' service)
./prod.sh migrate up        # Apply migrations with auto-backup
./prod.sh exec app sqlite3 /data/prod.db # Access production DB
```

## Key Architectural Patterns

### Backend Patterns
- **Request Flow**: Sanitize -> Strategy Selection -> Orchestrate -> Persist -> Respond.
- **Tool System**: Modular, registry-based, supports Playwright automation for SPAs.
- **Database**: Migration-driven, in-memory TTL caching, bcrypt (cost 10) for passwords, user-scoped Journal for memory.

### Frontend Patterns
- **State Management**: Specialized controller hooks (`useMessageSendPipeline`, `useDraftPersistence`) orchestrated by `useChatV2Controller`.
- **API Integration**: Centralized HTTP client (`lib/http.ts`) and streaming utilities (`lib/streaming.ts`).
- **Components**: Separation of container/presentational logic; dynamic UI adjustment based on model capabilities.

## Core Conventions

- **Adding Features**: Register backend routes, modularize tools, use centralized HTTP client on frontend, and always use migrations for schema changes.
- **Testing**: Match existing patterns, include authentication context, and verify both services before committing.
- **Gentle Reminders**: Always enforce `user_id` isolation in DB queries, use structured error responses with exponential backoff for APIs, maintain strict type safety, and ensure all services pass linting and tests.

## Finding Your Way Around

- **Routes & Tools**: `backend/src/routes/`, `backend/src/lib/tools/`
- **Frontend Logic**: `frontend/hooks/` (controllers), `frontend/lib/` (utilities)
- **UI Components**: `frontend/components/` (organized by feature)
- **Database Schema**: `backend/scripts/` (migrations)
- **Upstream Logs**: `backend/logs/` (read bottom lines for recent API activity)

## Documentation Map

- [ARCHITECTURE.md](docs/ARCHITECTURE.md): Tech stack, design principles, and schema.
- [backend_api_spec.md](docs/backend_api_spec.md): Complete REST API specification.
- [tool_orchestration_deep_dive.md](docs/tool_orchestration_deep_dive.md): Execution loops and streaming details.
- [ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md): Full config reference.
- [DEVELOPMENT.md](docs/DEVELOPMENT.md): Contribution workflows and testing guide.
- [TOOLS.md](docs/TOOLS.md): Implementing and registering new tools.

---

This architecture prioritizes **separation of concerns**, **type safety**, and **user data isolation**.
