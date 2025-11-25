# Architecture Overview

## Tech Stack

### Frontend

- **Next.js 15.4** - React framework with App Router
- **React 19** - UI library
- **TypeScript 5.9** - Type safety
- **Tailwind CSS 4** - Styling
- **React Markdown** - Markdown rendering with rehype plugins
- **Lucide React** - Icon library
- **highlight.js** - Code syntax highlighting
- **KaTeX** - Math rendering
- **@floating-ui/react** - Tooltips and dropdowns

### Backend

- **Node.js** - Runtime with ES modules
- **Express.js 5.1** - Web framework
- **SQLite with better-sqlite3 9.4** - Database
- **Pino 9.3** - Logging with rotation
- **node-fetch 3.3** - HTTP client for provider APIs
- **bcryptjs** - Password hashing
- **jsonwebtoken** - JWT authentication
- **multer** - File upload handling
- **zod** - Input validation
- **express-rate-limit** - Rate limiting
- **@mozilla/readability** - Web scraping
- **turndown** - HTML to Markdown conversion
- **jsdom** - DOM manipulation

## Project Structure

```
chat/
├── frontend/                      # Next.js 15 + React 19 + TypeScript
│   ├── app/                       # Next.js App Router pages
│   ├── components/                # React UI components
│   ├── hooks/                     # Custom React hooks
│   ├── contexts/                  # React context providers
│   ├── lib/                       # Utilities and type definitions
│   └── __tests__/                 # Frontend test suite
├── backend/                       # Node.js + Express + SQLite
│   ├── src/                       # Main source code
│   │   ├── routes/                # API endpoints
│   │   ├── lib/                   # Core logic (tools, orchestrators)
│   │   ├── middleware/            # Express middleware
│   │   ├── db/                    # Database layer
│   │   └── prompts/               # System prompt templates
│   ├── scripts/                   # Database migrations
│   └── __tests__/                 # Backend test suite
├── docs/                          # Architecture documentation
├── proxy/                         # Dev-only Nginx reverse proxy configuration
├── integration/                   # Integration tests
├── requests/                      # HTTP request examples
└── docker-compose files           # Container orchestration
```

## Key Components

### Frontend

- **ChatV2.tsx** - Main chat container managing layout and sidebar
- **MessageList.tsx** - Message rendering with streaming support
- **MessageInput.tsx** - User input with file/image upload
- **useChat Hook** - Centralized state management for chat functionality

### Backend

- **API Proxy** (`backend/src/routes/chat.js`) - OpenAI-compatible chat completions endpoint
- **Tool Orchestrator** (`backend/src/lib/orchestrators/`) - Server-side tool execution
- **Persistence Layer** (`backend/src/lib/persistence/`) - SQLite conversation storage
- **Adapters** (`backend/src/adapters/`) - Provider-specific API implementations
- **Authentication** (`backend/src/routes/auth.js`) - JWT-based user auth

## Core Design Principles

1. **User-Based Data Isolation** - All data operations scoped to authenticated users
2. **JWT Authentication** - Secure token-based authentication with refresh tokens
3. **Multi-Tenancy** - Per-user provider configs, conversations, and settings
4. **Server-Side Tool Orchestration** - Tools execute on backend, not client
5. **OpenAI API Compatibility** - Maintains OpenAI contract while extending features
6. **Real-time Streaming** - SSE-based streaming with tool execution visibility
7. **Conversation Snapshots** - Complete settings persist for reproducibility
8. **Multimodal Support** - Image and file upload with validation
9. **Reasoning Controls** - Support for reasoning effort and extended thinking
10. **Prompt Caching** - Automatic cache breakpoints for cost reduction

## Request Flow

```
HTTP Request
    ↓
Session Resolution
    ↓
Rate Limiting
    ↓
Authentication Middleware
    ↓
Route Handler
    ↓
Business Logic (Tool Orchestration, etc.)
    ↓
Database Persistence
    ↓
Response (JSON or SSE Stream)
```

## API Endpoints

For detailed API endpoint documentation, see [backend_api_spec.md](backend_api_spec.md).

Main categories:
- **Authentication** - Register, login, refresh tokens
- **Chat** - Completions with streaming
- **Conversations** - CRUD operations and message editing
- **Providers** - Multi-provider configuration
- **System Prompts** - Prompt management
- **Images & Files** - Upload and serve media
- **User Settings** - Preference management
- **Health** - Server health checks

## Database Schema

ChatForge uses SQLite with migration-based schema evolution. Key tables:

- **users** - User accounts with password hashing
- **conversations** - User conversations with settings snapshots
- **messages** - Chat messages with user isolation
- **providers** - Per-user provider configurations
- **images** - User-uploaded images with metadata
- **files** - User-uploaded files with content
- **system_prompts** - Built-in and custom prompts
- **settings** - User preferences
- **journal_entries** - Persistent AI memory

All tables enforce user-based data isolation with NOT NULL `user_id` constraints.

## Authentication Architecture

- **JWT Tokens** - Access tokens (short-lived) and refresh tokens (long-lived)
- **Password Security** - bcrypt hashing with cost factor 10
- **JWT Secrets** - Stored in environment variables, never in database
- **Session Management** - User context tracked per authenticated request

## Tool System

Tools are modular, independent units that execute on the server:

- **Registry-based Discovery** - Tools registered in tool system
- **Parallel Execution** - Tools can execute in parallel when supported
- **Unified Interface** - Consistent validation and execution pattern
- **Error Handling** - Graceful failures with error context

See [TOOLS.md](TOOLS.md) for adding new tools.

## Performance Considerations

- **In-Memory Caching** - Models and capabilities cached with TTL
- **Model Filtering** - Provider-level filtering with wildcard patterns
- **Batch Operations** - Database operations batched for efficiency
- **Streaming Support** - Real-time SSE streaming to reduce perceived latency
- **Prompt Caching** - Automatic cache breakpoints for compatible providers

## Deployment Architecture

### Development

- **Docker Compose** - Orchestrates frontend, backend, proxy, and adminer for hot reload
- **Hot Reload** - Changes automatically reload during development
- **Unified Network** - Containers communicate via docker network

### Production

- **Single App Container** - Multi-stage `Dockerfile` builds the frontend export and copies it into the Express backend, which serves both `/api` and the UI from one process
- **Volumes** - `/data` for SQLite + uploads, `/app/logs` for rolling logs
- **Runtime** - Same Express server handles health checks and static assets on port 3000 (configurable)
- **Backups** - `prod.sh backup` copies the SQLite database from the shared volume

## Documentation

For deeper technical details, see:
- [backend_code_flow.md](backend_code_flow.md) - Backend architecture and request handling
- [frontend_code_flow.md](frontend_code_flow.md) - Frontend architecture and state management
- [backend_api_spec.md](backend_api_spec.md) - Complete API endpoint documentation
- [tool_orchestration_deep_dive.md](tool_orchestration_deep_dive.md) - Tool system details
