# AI Onboarding Guide

This document provides essential knowledge for AI agents to be immediately productive in this codebase.

## Project Overview

**ChatForge** is a modern chat application with a Next.js frontend and Node.js backend, designed as an OpenAI API proxy with enhanced features like conversation persistence, tool orchestration, multi-provider support, JWT authentication, user-scoped multi-tenancy, image/audio/file uploads, advanced reasoning controls, prompt caching optimization, persistent memory via journal tool, model comparison mode, conversation forking, and Electron desktop app support.

## Architecture Overview

### High-Level Structure
```
chat/
  frontend/             # Next.js 15 + React 19 + TypeScript
  backend/              # Node.js + Express + SQLite
  electron/             # Electron desktop app packaging
  docs/                 # Architecture docs and ADRs
  proxy/                # Dev-only Nginx reverse proxy config (compose.dev)
  integration/          # Integration tests
  requests/             # HTTP request examples
  dev.sh                # Development orchestration script
  prod.sh               # Production management script
  release.sh            # Release management script
  AGENTS.md             # This file - AI onboarding guide
```

### Service Boundaries

**Frontend**
- Next.js App Router with real-time streaming UI
- State management via React hooks/reducers
- Direct API calls to backend

**Backend**
- Express API server acting as OpenAI-compatible proxy
- SQLite for persistence
- Server-side tool orchestration
- User-based authentication and authorization

> **Production bundling:** The root multi-stage `Dockerfile` exports the Next.js app and copies it into the Express backend, so the `app` container (managed by `prod.sh` / `docker-compose.yml`) serves both `/api` and static assets. The standalone `frontend`, `backend`, and `proxy` containers only exist in the development compose stack for hot reload.

### Core Design Principles

1. **User-Based Data Isolation**: All data operations are scoped to authenticated users (enforced at database level with NOT NULL user_id constraints)
2. **JWT Authentication**: Secure authentication with JWT access tokens and refresh tokens
3. **Multi-Tenancy**: Per-user provider configurations, conversations, settings, and resources
4. **Server-Side Tool Orchestration**: Tools execute on the backend, not client
5. **OpenAI API Compatibility**: Backend presents OpenAI-compatible interface while adding features
6. **Real-time Streaming**: SSE-based streaming for chat and tool execution
7. **Conversation Settings Persistence**: Complete snapshots of conversation settings (model, provider, tools, reasoning controls) persist across edits and regenerations
8. **Multimodal Support**: Full image, audio, and file handling with upload, paste, preview, and secure metadata storage
9. **Reasoning Controls**: Support for reasoning effort levels and extended thinking modes
10. **Prompt Caching**: Automatic prompt caching with cache breakpoints to reduce costs and latency
11. **Persistent Memory**: Journal tool provides AI with cross-conversation memory storage
12. **Model Comparison Mode**: Side-by-side comparison of responses from multiple models with isolated histories
13. **Conversation Forking**: Fork conversations at any point to explore alternative paths
14. **Parallel Tool Execution**: Configurable concurrent tool execution for improved performance
15. **Streaming Control**: Ability to abort streaming responses and automatic checkpoint persistence
16. **Desktop App**: Cross-platform Electron app with auto-login and native packaging
17. **Enhanced WebFetch**: Playwright-based browser automation for SPA support with specialized content extractors

## Development Workflow

**All development commands run in Docker via `./dev.sh`:**

### Container Management
```bash
./dev.sh up              # Start all services
./dev.sh up --build      # Start and rebuild containers
./dev.sh up -d           # Start in detached mode
./dev.sh down            # Stop and remove containers
./dev.sh restart         # Restart all services
./dev.sh build           # Build container images
./dev.sh ps              # Show running services
```

### Logs
```bash
./dev.sh logs         # logs from all services
./dev.sh logs frontend # frontend logs only
./dev.sh logs backend  # backend logs only
./dev.sh logs --tail=100  # Show last 100 log lines
```

### Running Commands in Containers
```bash
./dev.sh exec backend npm test    # Run backend tests
./dev.sh exec frontend npm run build # Build frontend
./dev.sh exec backend npm run lint # Run backend linter
./dev.sh exec backend sh -c "ls -la" # Execute shell commands
```

### Testing
```bash
./dev.sh test                    # Run all tests (backend + frontend)
./dev.sh test:backend            # Run backend tests only
./dev.sh test:frontend           # Run frontend tests only
./dev.sh test:backend __tests__/conversations.test.js # Run specific test file
```

### Database Migrations
```bash
./dev.sh migrate status   # Check migration status
./dev.sh migrate up       # Apply pending migrations
./dev.sh migrate fresh    # Reset database and reapply all migrations
```

### Additional Services
```bash
# Adminer database management (available at http://localhost:3080)
# Provides password-less login for SQLite database inspection
```

### Production Management
```bash
./prod.sh up [--build]     # Start production services (detached)
./prod.sh down             # Stop services (requires confirmation)
./prod.sh restart          # Restart services
./prod.sh ps               # Show service status
./prod.sh logs [-f]        # View logs
./prod.sh health           # Check health status
./prod.sh migrate status   # Check migration status
./prod.sh migrate up       # Apply migrations (with confirmation + auto-backup)
./prod.sh migrate fresh    # Reset database (requires double confirmation)
./prod.sh backup           # Create database backup
./prod.sh exec <service> <command>  # Execute command in container
```
> In production there is a single `app` service. Most `prod.sh exec` commands therefore look like `./prod.sh exec app <command>`.

### Release Management
```bash
./release.sh               # Interactive release process (merge develop to main, tag, create next develop)
./release.sh --dry-run     # Validate without releasing (lint + build only)
```

## Key Architectural Patterns

### Backend Patterns

**Request Flow Philosophy**:
- Sanitize incoming requests
- Select execution strategy based on request characteristics
- Execute with appropriate orchestration
- Persist results with user isolation
- Return OpenAI-compatible responses

**Tool System Philosophy**:
- Tools are modular, independent units
- Registry-based discovery and execution
- Tools can execute in parallel with configurable concurrency (user-configurable max iterations)
- Backend expands simplified tool names to full specifications
- WebFetch tool supports Playwright-based browser automation for SPAs with specialized extractors for Reddit, StackOverflow, and other sites
- Automatic checkpoint persistence ensures buffered tool calls/outputs survive client disconnects

**Database Philosophy**:
- User-based data isolation at query level (enforced with NOT NULL constraints on user_id)
- Migration-driven schema evolution (20+ migrations applied)
- Automatic cleanup for data retention (default 30 days)
- In-memory caching with TTL support for performance optimization
- Password security with bcrypt hashing (cost factor 10)
- JWT secrets stored in environment (never in database)
- Image and file metadata stored with user ownership validation
- Journal entries scoped per user for persistent AI memory

### Frontend Patterns

**State Management Philosophy**:
- Simplified state management with `useChat` hook using React `useState`
- Direct state manipulation without complex reducer patterns
- Encapsulated state and actions in a single custom hook
- URL state synchronization for navigation

**API Integration Philosophy**:
- Centralized HTTP client (`lib/http.ts`) for consistent error handling
- Streaming utilities (`lib/streaming.ts`) for real-time data processing
- Authentication state drives UI and API behavior
- Type definitions centralized in `lib/types.ts`

**Component Philosophy**:
- Separation between container and presentational components
- Tool visualization integrated into message rendering
- Authentication-aware UI components with login/register flows
- Image handling with drag-and-drop, paste support, and preview modals
- File upload support with drag-and-drop for text files
- Enhanced markdown rendering with language detection, syntax highlighting, copy functionality, code wrapping, and HTML preview
- Model capabilities dynamically adjust UI based on selected model features
- Reasoning controls (effort slider) shown conditionally based on model support
- User settings UI for per-user API key management
- Model comparison mode with multi-column layout for side-by-side responses
- Conversation forking UI integrated into message toolbars
- Toast notifications for user feedback
- Draft message persistence with auto-save
- Abort streaming button for canceling in-progress responses
- Mobile-responsive design with auto-hide scroll buttons

## Core Conventions

### Adding New Features

**Backend Routes**: Create in routes directory, apply auth middleware where needed, register in main server file

**Tools**: Follow modular tool pattern, register in tool system, ensure validation and error handling

**Frontend Components**: Follow existing patterns, use centralized HTTP client, respect authentication boundaries

**Database Schema**: Use migrations, maintain user isolation, follow existing table patterns

**Testing**: Match existing test patterns, include authentication context, use provided test utilities

### Universal Rules

- **Authentication**: Always check user authentication for data operations (user_id is required and enforced)
- **Error Handling**: Use structured error responses, sanitize upstream errors, exponential backoff retry logic for API calls
- **Logging**: Structured logging for debugging and monitoring
- **Type Safety**: TypeScript strict mode on frontend, JSDoc or validation on backend
- **Testing**: Write tests before committing, both services must pass
- **Code Quality**: ESLint configured for both frontend and backend with strict linting rules enforced by Husky pre-commit hooks

## Important Architectural Decisions

- **Provider Adapters**: System automatically selects appropriate API adapter based on upstream provider URL (ChatCompletions API vs Responses API)
- **Tool Execution**: Always server-side, never client-side
- **Data Isolation**: All queries filtered by authenticated user (enforced at database level with NOT NULL constraints)
- **JWT Authentication**: Token-based authentication with bcrypt password hashing and refresh token support
- **Streaming Protocol**: SSE for real-time updates with usage metadata tracking
- **API Compatibility**: Maintains OpenAI API contract while extending functionality
- **Dev Reverse Proxy**: Nginx proxy routes /api requests to backend in the Docker *development* stack (production bundles everything into one container)
- **Image Storage**: Secure image metadata storage with path-based access control and validation (max 10MB, 5 images/message)
- **File Storage**: Text file uploads with content extraction (max 5MB, 3 files/message, 30+ file types supported)
- **Conversation Snapshots**: Each conversation maintains complete settings snapshot for reproducibility
- **Reasoning Controls**: Advanced reasoning features (effort levels, extended thinking) available across compatible models
- **Prompt Caching**: Automatic cache breakpoint insertion for Anthropic models to reduce token costs
- **User Settings**: Per-user API keys for tools (Tavily, Exa, SearXNG) and configurable max tool iterations stored securely
- **Journal Tool**: Persistent memory system allowing AI to store and retrieve notes across conversations
- **Performance**: In-memory caching, model filtering by provider, optimized rendering, batch database operations, and model caching with background refresh
- **Model Comparison**: Multi-model comparison mode with isolated conversation histories for side-by-side evaluation
- **Conversation Forking**: Ability to fork conversations at any message to explore alternative paths
- **Parallel Tool Execution**: Configurable concurrent tool execution with user-defined max iterations
- **Streaming Abort**: Client-initiated abort of streaming responses with automatic checkpoint persistence
- **WebFetch Enhancement**: Playwright-based browser automation with specialized content extractors for Reddit, StackOverflow, and SPA support
- **Draft Persistence**: Automatic draft message saving across sessions
- **HTML Preview**: In-modal HTML rendering for code blocks
- **Electron App**: Cross-platform desktop app with auto-login and native packaging
- **Linked Conversations**: Support for conversation linking and retrieval in conversation context
- **Reasoning Format Support**: Support for reasoning_format parameter across compatible models
- **Retry Logic**: Exponential backoff for API calls (particularly Gemini 429 errors) with configurable retry strategy
- **Code Quality**: Husky pre-commit hooks enforce linting before commits
- **Toast Notifications**: User-facing notifications for errors and success messages

## Finding Your Way Around

**Route definitions**: Look in `backend/src/routes/`
**Tool implementations**: Look in `backend/src/lib/tools/`
**State management**: Check `frontend/hooks/useChat.ts` - single custom hook managing all chat state and actions
**Other hooks**:
  - `frontend/hooks/useSystemPrompts.ts` - System prompt management
  - `frontend/hooks/useSecureImageUrl.ts` - Secure image URL handling
**Core utilities**: Check `frontend/lib/` for shared functionality:
  - `http.ts` - Centralized HTTP client
  - `streaming.ts` - Streaming utilities
  - `types.ts` - Type definitions
  - `api.ts` - API integration
  - `storage.ts` - Browser storage utilities
  - `contentUtils.ts` - Content processing utilities
  - `modelCapabilities.ts` - Model capability detection
**Database schema**: Check migration files in `backend/scripts/`
**UI components**: Check `frontend/components/` organized by feature:
  - Main chat components: `ChatV2.tsx`, `MessageList.tsx`, `MessageInput.tsx`
  - Layout: `ChatHeader.tsx`, `ChatSidebar.tsx`, `RightSidebar.tsx`
  - Markdown rendering: `Markdown.tsx` (includes HTML preview, code wrapping, syntax highlighting)
  - Settings: `SettingsModal.tsx`
  - Model selection: `ModelSelector.tsx`, `CompareSelector.tsx` (unified base component pattern)
  - UI primitives: `components/ui/`
  - Toast notifications: Check toast integration in relevant components
**Image handling**: Check `frontend/components/ui/ImagePreview.tsx` (exports both `ImagePreview` and `ImageUploadZone`)
**Audio handling**: Check `frontend/components/ui/AudioPreview.tsx` (exports `AudioPreview`) and `frontend/lib/audioUtils.ts`
**File handling**: Check `backend/src/routes/files.js` for file upload API and `frontend/lib/api.ts` for client integration
**Authentication**: Check `backend/src/routes/auth.js` for auth routes and `frontend/contexts/AuthContext.tsx` for client-side auth state
**User settings**: Check `backend/src/routes/userSettings.js` for settings API and `frontend/components/SettingsModal.tsx` for client integration
**Journal tool**: Check `backend/src/lib/tools/journal.js` for persistent memory implementation
**WebFetch tool**: Check `backend/src/lib/tools/webFetch.js` for Playwright-based browser automation and specialized content extractors
**Electron app**: Check `electron/` directory for desktop app packaging and configuration
**Model comparison**: Check `frontend/hooks/useChat.ts` for comparison mode state management
**Conversation forking**: Check conversation forking logic in `frontend/components/` message toolbar components
**Documentation**: Check `docs/` for ADRs and detailed specs
**Backend API Specification**: Check `docs/backend_api_spec.md` for the complete backend API specification
**Linting**: ESLint configs in both `frontend/` and `backend/` directories, Husky hooks in `.husky/`
**Upstream Logging**: Request and response of upstream API are in `backend/logs/` folder. These files are very long, only read a dozen of lines from the bottom. You can read them without executing in docker container, they have been mounted to this project directory.

---

This architecture prioritizes **separation of concerns**, **type safety**, and **user data isolation** while maintaining **OpenAI API compatibility** and **production reliability**.
