# AI Onboarding Guide

This document provides essential knowledge for AI agents to be immediately productive in this codebase. It focuses on the "big picture" architecture, critical workflows, and project-specific patterns.

## Project Overview

**ChatForge** is a modern chat application with a Next.js frontend and Node.js backend, designed as an OpenAI API proxy with enhanced features like conversation persistence, tool orchestration, and multi-provider support.

## Architecture Overview

### High-Level Structure
```
chat/
  frontend/             # Next.js 15 + React 19 + TypeScript
  backend/              # Node.js + Express + SQLite
  docs/                 # Architecture docs and ADRs
  docker-compose.dev.yml
  docker-compose.yml
  dev.sh                # Development orchestration script
  package.json          # Root workspace with shared scripts
```

### Service Boundaries

**Frontend (service port 3000; dev containers expose http://localhost:3003)**
- Next.js app with App Router
- Real-time chat interface with streaming support
- State management via React hooks/reducers
- Direct API calls to backend (no SSR for chat data)
- Docker dev serves on http://localhost:3003

**Backend (service port 3001; dev containers expose http://localhost:4001)**
- Express.js API server
- OpenAI API proxy with tool orchestration
- SQLite database for conversation persistence
- Rate limiting and session management
- Docker dev serves on http://localhost:4001

### Key Integration Points

1. **API Communication**: Frontend makes direct HTTP calls to backend at `http://localhost:3001`
2. **Real-time Streaming**: Server-Sent Events (SSE) for chat message streaming
3. **Session Management**: Session-based conversation tracking via middleware
4. **Tool Orchestration**: Backend handles tool execution with iterative/unified modes
5. **Responses API Adapter**: OpenAI provider automatically switches to the Responses API when the upstream base URL targets `api.openai.com`
6. **Reasoning Controls**: `reasoning_effort` and `verbosity` parameters are stripped unless the provider reports support

## Critical Developer Workflows

### Development Commands

**All development commands must be run in Docker.** Use the `./dev.sh` helper script to manage the Docker environment and run commands without entering containers.

**Root level** (`package.json` scripts):
```bash
# Run tests for both frontend and backend
./dev.sh test

# Run linting for both services
./dev.sh exec backend npm run lint

# Individual service testing
./dev.sh test:backend
./dev.sh test:frontend
```

**Development script** (`./dev.sh`):
```bash
./dev.sh up --build    # Start development environment
./dev.sh logs -f       # Follow logs
./dev.sh exec backend npm test  # Run backend tests in container
./dev.sh test          # Run backend and frontend test suites locally
./dev.sh migrate up    # Run database migrations
```

**Frontend development**:
```bash
./dev.sh up --build     # Start with Turbopack in Docker
./dev.sh exec frontend npm run build  # Production build
./dev.sh test:frontend  # Jest tests
```

**Backend development**:
```bash
./dev.sh up --build     # Nodemon with auto-reload in Docker
./dev.sh migrate up     # Database migrations
./dev.sh exec backend npm run format  # Prettier formatting
```

### Testing Strategy

- **Backend**: Jest with ES modules (`NODE_OPTIONS=--experimental-vm-modules`)
- **Frontend**: Jest + Testing Library + jsdom environment
- **Integration**: Test utilities in `backend/test_utils/` and `frontend/__tests__/`

### Build and Deployment

**Development**: Uses `docker-compose.dev.yml` with volume mounts
**Production**: Uses `docker-compose.yml` with optimized builds

Both services have Dockerfiles with multi-stage builds and proper entrypoint scripts for environment handling.

## Project Conventions and Patterns

### Backend Patterns

**Route Organization** (`backend/src/routes/`):
- `chat.js` - Main chat completions proxy (`/v1/chat/completions`)
- `conversations.js` - Conversation CRUD operations
- `providers.js` - Provider configuration management
- `health.js` - Health check endpoint

**Request Flow Pattern**:
1. `proxyOpenAIRequest()` sanitizes and validates requests
2. Strategy selection based on tools + streaming flags:
   - tools + stream -> `handleToolsStreaming()` (iterative orchestration)
   - tools + json -> `handleToolsJson()` (unified orchestration)
   - plain + stream -> `handleRegularStreaming()`
   - plain + json -> direct proxy via `createOpenAIRequest()`
3. `SimplifiedPersistence` handles conversation storage
4. Response metadata injection for conversation tracking
5. `OpenAIProvider` selects `ResponsesAPIAdapter` or `ChatCompletionsAdapter` based on the upstream base URL

**Tool System Architecture**:
- Tool specs defined in `backend/src/lib/tools.js`
- Frontend sends simplified tool names, backend expands to full OpenAI specs
- Two orchestration modes: iterative streaming via `handleToolsStreaming()` and unified JSON via `handleToolsJson()`
- `web_search` requires `TAVILY_API_KEY` in the backend environment

**Error Handling Pattern**:
- Structured logging with `pino` logger
- Upstream errors are sanitized and mapped to client-safe responses
- Persistence layer marks failed requests for cleanup

### Frontend Patterns

**State Management** (`frontend/hooks/useChatState.ts`):
- Single reducer managing all chat state
- Actions are dispatched for all state changes
- Local storage integration for UI preferences
- Optimistic updates with server reconciliation

**Component Architecture**:
- `ChatV2` - Main container component
- `MessageList` - Handles message rendering and tool outputs
- `MessageInput` - Input with tool configuration
- `ChatSidebar` - Conversation history
- `RightSidebar` - System prompt configuration

**API Integration Pattern** (`frontend/lib/chat/`):
- `client.ts` - HTTP client with error handling
- `sendChat()` function handles streaming vs JSON modes
- Server-Sent Events parsing in dedicated modules
- Type-safe interfaces for all API responses

**URL State Management**:
- Conversation ID synchronized with URL query params (`?c=...`)
- Browser back/forward navigation triggers state changes
- Initial conversation loading from URL on app startup

### Configuration Patterns

**Environment Configuration**:
- Backend uses `dotenv` with validation in `env.js`
- Frontend uses Next.js built-in env support
- Dynamic provider settings are stored in SQLite (`providers` table) and exposed via `/v1/providers`; environment variables act as a fallback
- Provider configurations support multiple API services
- Docker environment overrides for deployment

**Database Patterns**:
- SQLite with migration system (`better-sqlite3-migrations`)
- Conversation-centric schema with message trees
- Automatic retention cleanup with configurable days
- Session-based partitioning for data isolation

## Key Dependencies and Integration Points

### External Dependencies

**Backend Core**:
- `express` - Web framework
- `better-sqlite3` - Database driver
- `pino` - Structured logging with rotation
- `node-fetch` - HTTP client for provider APIs
- `uuid` - ID generation

**Frontend Core**:
- `next` 15 - React framework with App Router
- `react` 19 - UI library with concurrent features
- `tailwindcss` 4 - Utility-first CSS framework
- `react-markdown` - Markdown rendering with syntax highlighting
- `@floating-ui/react` - Positioning for dropdowns/tooltips

### Provider Integration

**Multi-Provider Support**:
- Configured via `PROVIDER` environment variable
- Falls back to OpenAI-compatible API format
- Provider-specific features like reasoning controls for supported models
- Custom headers and authentication per provider

**Tool Integration**:
- Tools are registered in backend and available via `/v1/tools` endpoint
- Frontend receives tool specifications and allows per-tool enablement
- Server handles tool execution with output streaming
- Built-in tools: `get_time`, `web_search` (extensible system)
- `/v1/providers` endpoints manage credentials, model discovery, and connection tests without exposing API keys to the client

## Development Environment Setup

### Prerequisites
- Node.js 18+ (for ES modules support)
- Docker and Docker Compose
- Environment files (`.env` in both frontend/ and backend/)
- Optional: `TAVILY_API_KEY` to enable the Tavily-backed `web_search` tool

### Quick Start
```bash
# Copy environment templates
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env

# Start development environment
./dev.sh up --build

# Run migrations
./dev.sh migrate up

# Access application (docker-compose.dev host ports)
# Frontend: http://localhost:3003
# Backend API: http://localhost:4001
```

### Common Development Tasks

**Adding new API routes**: Create in `backend/src/routes/`, export router, register in `index.js`

**Adding new tools**: Define spec in `tools.js`, implement handler, update tool registry

**Frontend component changes**: Use existing patterns in `components/`, follow TypeScript strict mode

**Database changes**: Create migration in `backend/scripts/migrate.js`, test with `./dev.sh migrate`

**Testing changes**: Follow existing test patterns, ensure both services pass before committing

This architecture prioritizes clear separation of concerns, type safety, and developer experience while maintaining production reliability through Docker containerization and structured error handling.