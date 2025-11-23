# ChatForge

> A modern AI chat application with advanced tool orchestration and OpenAI-compatible API proxy

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](https://www.docker.com)

ChatForge is a full-stack AI chat application featuring a Next.js 15 frontend and Node.js backend. It acts as an OpenAI-compatible API proxy with enhanced capabilities including conversation persistence, server-side tool orchestration, and multi-provider support.

## Features

- **🤖 Server-Side Tool Orchestration** - Unified tool calling with iterative workflows, thinking support, and intelligent error handling
- **💬 Real-Time Streaming** - Server-Sent Events (SSE) with tool execution visibility and abort support
- **💾 Conversation Persistence** - SQLite-backed storage with automatic retention cleanup and migration system
- **🔌 Multi-Provider Support** - OpenAI-compatible interface with OpenAI, Anthropic, and Gemini providers featuring automatic API adapter selection, Responses API optimization, and per-user provider configuration
- **🎨 Modern UI** - React 19 with quality controls, markdown rendering, syntax highlighting, and responsive design
- **🗂️ Prompt Management** - Built-in and custom system prompts with conversation-aware selection
- **🧪 Comprehensive Testing** - Jest test suites for both frontend and backend with integration utilities
- **🐳 Docker Ready** - Development and production Docker configurations with hot reload support
- **🔐 Authentication & User Management** - JWT-based authentication with registration, login, refresh tokens, and user session management
- **👤 User-Scoped Multi-Tenancy** - Per-user provider configuration with isolated conversations, messages, and settings
- **🖼️ Image Upload & Vision Support** - Multimodal vision support with image upload, local/S3 storage, drag-and-drop UI, and validation
- **📎 File Attachment Support** - Text file upload for code and documentation with content extraction and context injection
- **🧠 Reasoning Controls & Extended Thinking** - Support for reasoning effort and verbosity controls with thinking blocks and token tracking
- **💾 Prompt Caching Optimization** - Automatic prompt caching with cache breakpoints to reduce token costs and latency
- **🔍 Model Filtering & Capabilities Detection** - Provider-level model filtering with wildcard patterns and automatic capability detection
- **⚙️ User Settings & Preferences** - Persistent user preferences including search API keys and conversation settings
- **📓 Journal Tool** - Persistent memory tool allowing AI to store and retrieve notes across conversations

## Prerequisites

- Node.js 18 or higher
- Docker and Docker Compose (for containerized deployment)
- OpenAI API key or compatible provider API key

## Quick Start

### Local Development (Node.js)

```bash
# Clone the repository
git clone <repository-url>
cd chat

# Set up backend
cp backend/.env.example backend/.env
# Edit backend/.env and set:
# - OPENAI_API_KEY (your API key)
# - JWT_SECRET (a secure random string for authentication)
npm --prefix backend install

# Set up frontend
cp frontend/.env.example frontend/.env.local
npm --prefix frontend install

# Start backend (terminal 1)
npm --prefix backend run dev

# Start frontend (terminal 2)
npm --prefix frontend run dev
```

Visit http://localhost:3000

In production the proxy exposes the backend at `https://<your-domain>/api`.

### Docker Development (Recommended)

```bash
# Copy environment files
cp backend/.env.example backend/.env
# Edit backend/.env and set:
# - OPENAI_API_KEY (your API key)
# - JWT_SECRET (a secure random string for authentication)

# Start with hot reload
./dev.sh up --build

# Follow logs
./dev.sh logs -f
```

Visit http://localhost:3003 (dev environment uses different ports)

API requests from the browser can now target `http://localhost:3003/api` via the bundled reverse proxy container.

### Docker Production

```bash
# Ensure required variables are set in backend/.env:
# - OPENAI_API_KEY
# - JWT_SECRET
./prod.sh up --build

# Check service health
./prod.sh health

# View logs
./prod.sh logs -f
```

Visit http://localhost:3000

## Project Structure

```
chat/
├── frontend/                      # Next.js 15 + React 19 + TypeScript
│   ├── app/                       # Next.js App Router pages
│   ├── components/                # React UI components
│   ├── hooks/                     # Custom React hooks (useChat, useSystemPrompts)
│   ├── contexts/                  # React context providers
│   ├── lib/                       # Utilities and type definitions
│   └── __tests__/                 # Frontend test suite
├── backend/                       # Node.js + Express + SQLite
│   ├── src/                       # Main source code
│   │   ├── routes/                # API endpoints
│   │   ├── lib/                   # Core logic (tools, orchestrators, persistence)
│   │   ├── middleware/            # Express middleware
│   │   ├── db/                    # Database layer
│   │   └── prompts/               # System prompt templates
│   ├── scripts/                   # Database migrations
│   └── __tests__/                 # Backend test suite (45+ test files)
├── docs/                          # Architecture documentation
│   ├── adapters/                  # API adapter specifications
│   ├── reasoning/                 # Reasoning implementation docs
│   ├── backend_api_spec.md        # Backend API documentation
│   ├── backend_code_flow.md       # Backend architecture flow
│   ├── frontend_code_flow.md      # Frontend architecture flow
│   └── tool_orchestration_deep_dive.md
├── proxy/                         # Nginx reverse proxy configuration
├── integration/                   # Integration tests
├── requests/                      # HTTP request examples for API testing
├── AGENTS.md                      # AI agent onboarding guide
├── dev.sh                         # Development orchestration script
├── prod.sh                        # Production management script
├── release.sh                     # Release management script
├── docker-compose.yml             # Production Docker setup
├── docker-compose.dev.yml         # Development Docker setup
└── package.json                   # Root workspace scripts
```

## Development

### Available Scripts

#### Development (dev.sh)

```bash
# Service management
./dev.sh up [--build]      # Start services (optionally rebuild)
./dev.sh down              # Stop and remove services
./dev.sh restart           # Restart services
./dev.sh build             # Build service images
./dev.sh ps                # Show service status

# Logs
./dev.sh logs [-f]         # View logs (optionally follow)
./dev.sh logs -f frontend  # Follow specific service logs

# Testing
./dev.sh test              # Run all tests
./dev.sh test:backend      # Backend tests only
./dev.sh test:frontend     # Frontend tests only

# Database migrations
./dev.sh migrate status    # Check migration status
./dev.sh migrate up        # Apply pending migrations
./dev.sh migrate fresh     # Reset database (destructive)

# Execute commands
./dev.sh exec <service> <command>  # Run command in container
./dev.sh exec backend npm run lint # Example: backend linting
```

#### Production (prod.sh)

```bash
# Service management
./prod.sh up [--build]     # Start services (detached, optionally rebuild)
./prod.sh down             # Stop services (requires confirmation)
./prod.sh restart          # Restart services
./prod.sh ps               # Show service status

# Monitoring
./prod.sh logs [-f]        # View logs (optionally follow)
./prod.sh health           # Check health status

# Database operations
./prod.sh migrate status   # Check migration status
./prod.sh migrate up       # Apply migrations (with confirmation + auto-backup)
./prod.sh migrate fresh    # Reset database (requires double confirmation)
./prod.sh backup           # Create database backup

# Execute commands
./prod.sh exec <service> <command>  # Run command in container
```

#### Release Management (release.sh)

```bash
./release.sh               # Interactive release process
./release.sh --dry-run     # Validate without releasing (lint + build)
```

### Environment Variables

#### Backend (`backend/.env`)

**Required:**
```env
OPENAI_API_KEY=your-api-key-here          # OpenAI API key (or use PROVIDER_API_KEY)
JWT_SECRET=your-secret-key-here           # Secret for JWT authentication (required)
DEFAULT_MODEL=gpt-4o-mini                 # Default AI model
DEFAULT_TITLE_MODEL=gpt-4o-mini           # Model for conversation titles
PORT=3001                                  # Server port
RATE_LIMIT_WINDOW=60                       # Rate limit window in seconds
RATE_LIMIT_MAX=50                          # Max requests per window
CORS_ORIGIN=http://localhost:3000         # CORS allowed origin
```

**Optional - Provider Configuration:**
```env
PROVIDER=openai                            # Provider selection (openai, anthropic, gemini)
PROVIDER_BASE_URL=                         # Custom provider base URL
PROVIDER_API_KEY=                          # Generic provider API key
PROVIDER_CUSTOM_HEADERS={}                 # Custom headers as JSON
OPENAI_BASE_URL=https://api.openai.com/v1 # OpenAI base URL
ANTHROPIC_BASE_URL=https://api.anthropic.com # Anthropic base URL
ANTHROPIC_API_KEY=                         # Anthropic API key (if different from PROVIDER_API_KEY)
```

**Optional - Tool Configuration:**
```env
TAVILY_API_KEY=your-tavily-key            # Tavily web search (optional)
EXA_API_KEY=your-exa-key                  # Exa web search (optional)
SEARXNG_BASE_URL=                         # SearXNG instance URL (optional)
```

**Optional - Timeouts:**
```env
PROVIDER_TIMEOUT=10000                     # Provider operation timeout (ms)
MODEL_TIMEOUT=3000                         # Model fetching timeout (ms)
STREAMING_TIMEOUT=300000                   # Streaming timeout (ms)
```

**Optional - Logging:**
```env
LOG_LEVEL=info                             # Log level (trace/debug/info/warn/error/fatal)
PRETTY_LOGS=true                           # Human-friendly logs (dev only)
MAX_LOG_RETENTION_DAYS=3                   # Log retention days
```

**Optional - Persistence:**
```env
ENABLE_PERSISTENCE=true                    # Enable conversation persistence
DATABASE_URL=                              # Database URL (defaults to SQLite)
RETENTION_DAYS=30                          # Days to retain conversations
MAX_CONVERSATIONS_PER_SESSION=100          # Conversation limit per session
MAX_MESSAGES_PER_CONVERSATION=1000         # Message limit per conversation
BATCH_FLUSH_INTERVAL=250                   # Batch flush interval (ms)
```

**Optional - Storage:**
```env
IMAGE_STORAGE_PATH=./data/images           # Local image storage path
FILE_STORAGE_PATH=./data/files             # Local file storage path
```

**Optional - JWT:**
```env
JWT_EXPIRES_IN=1h                          # JWT token expiration
JWT_REFRESH_EXPIRES_IN=7d                  # Refresh token expiration
```

#### Frontend (`frontend/.env.local`)

```env
NEXT_PUBLIC_API_BASE=/api                  # API base path (required)
BACKEND_ORIGIN=http://localhost:3001       # Backend server origin (required)
NEXT_PUBLIC_APP_NAME=ChatForge             # Application name (optional)
```

### Adding New Tools

Tools are defined in `backend/src/lib/tools.js`:

```javascript
export const tools = {
  your_tool_name: {
    validate: (args) => {
      // Validate and normalize arguments
      if (!args?.requiredParam) {
        throw new Error('Missing requiredParam');
      }
      return { requiredParam: args.requiredParam };
    },
    handler: async (validatedArgs) => {
      // Implement tool logic
      return { result: 'success' };
    },
  },
};
```

Tools are automatically registered and available via the `/v1/tools` endpoint.

## Architecture

### Tech Stack

**Frontend:**
- Next.js 15.4 (App Router)
- React 19
- TypeScript 5.9
- Tailwind CSS 4
- React Markdown with rehype plugins
- Lucide React (icons)
- highlight.js (syntax highlighting)
- KaTeX (math rendering)
- @floating-ui/react (tooltips/dropdowns)

**Backend:**
- Node.js with ES modules
- Express.js 5.1
- SQLite with better-sqlite3 9.4
- Pino logging 9.3 with rotation
- node-fetch 3.3 (provider APIs)
- bcryptjs (password hashing)
- jsonwebtoken (JWT authentication)
- multer (file uploads)
- zod (validation)
- express-rate-limit (rate limiting)
- @mozilla/readability (web scraping)
- turndown (HTML to Markdown)
- jsdom (DOM manipulation)

### Key Components

- **API Proxy** (`backend/src/routes/chat.js`) - OpenAI-compatible chat completions endpoint
- **Tool Orchestrator** (`backend/src/lib/orchestrators/`) - Server-side tool execution with iterative workflows
- **Persistence Layer** (`backend/src/lib/persistence/`) - SQLite conversation storage
- **Chat State** (`frontend/hooks/useChatState.ts`) - Centralized state management
- **Adapters** (`backend/src/adapters/`) - Provider-specific API implementations (ChatCompletions, Responses API)

### API Endpoints

**Authentication:**
- `POST /v1/auth/register` - Register new user
- `POST /v1/auth/login` - Login and get JWT tokens
- `POST /v1/auth/refresh` - Refresh access token
- `GET /v1/auth/me` - Get current user profile
- `POST /v1/auth/logout` - Logout (client-side)

**Chat:**
- `POST /v1/chat/completions` - OpenAI-compatible chat endpoint with streaming
- `GET /v1/tools` - List available tools

**Conversations:**
- `GET /v1/conversations` - List conversations (paginated)
- `POST /v1/conversations` - Create conversation
- `GET /v1/conversations/:id` - Get conversation with messages
- `DELETE /v1/conversations/:id` - Delete conversation
- `PUT /v1/conversations/:id/messages/:messageId/edit` - Edit message and fork
- `POST /v1/conversations/migrate` - Migrate anonymous conversations

**Providers:**
- `GET /v1/providers` - List user's providers
- `GET /v1/providers/default` - Get effective default provider
- `GET /v1/providers/:id` - Get provider details
- `POST /v1/providers` - Create provider
- `PUT /v1/providers/:id` - Update provider
- `DELETE /v1/providers/:id` - Delete provider
- `POST /v1/providers/:id/default` - Set as default
- `GET /v1/providers/:id/models` - List provider models
- `POST /v1/providers/test` - Test provider connection
- `POST /v1/providers/:id/test` - Test existing provider

**System Prompts:**
- `GET /v1/system-prompts` - List all prompts
- `POST /v1/system-prompts` - Create custom prompt
- `PUT /v1/system-prompts/:id` - Update prompt
- `DELETE /v1/system-prompts/:id` - Delete prompt
- `POST /v1/system-prompts/:id/duplicate` - Duplicate prompt
- `POST /v1/system-prompts/:id/select` - Select for conversation
- `POST /v1/system-prompts/none/select` - Clear selection

**Images & Files:**
- `POST /v1/images` - Upload images
- `GET /v1/images/config` - Get image limits
- `GET /v1/images/:id` - Serve image (authenticated)
- `POST /v1/files` - Upload text files
- `GET /v1/files/config` - Get file limits
- `GET /v1/files/:id` - Serve file (authenticated)

**User Settings:**
- `GET /v1/settings` - Get user settings
- `PUT /v1/settings` - Update user settings

**Health:**
- `GET /health` - Health check
- `GET /healthz` - Health check (alias)

## Testing

```bash
# Run all tests
npm test

# Backend tests with coverage
npm run test:backend

# Frontend tests with watch mode
npm run test:frontend:watch
```

## Documentation

- [Overview](docs/OVERVIEW.md) - High-level architecture overview
- [Tech Stack](docs/TECH-STACK.md) - Detailed technology decisions
- [API Specs](docs/API-SPECS.md) - API endpoint documentation
- [Security & Privacy](docs/SECURITY.md) - Security considerations
- [Progress Log](docs/PROGRESS.md) - Development history
- [AI Onboarding](AGENTS.md) - Guide for AI assistants

## Roadmap

**Core Features (Complete):**
- [x] OpenAI-compatible API proxy with streaming
- [x] Server-side tool orchestration
- [x] Conversation persistence with SQLite
- [x] Modern React UI with real-time streaming
- [x] Docker development environment
- [x] Comprehensive testing infrastructure
- [x] Prompt management system
- [x] Authentication and authorization
- [x] Image and file upload system
- [x] Advanced reasoning controls
- [x] Per-user API key management
- [x] Multi-user provider management
- [x] Journal/memory tool
- [x] User data isolation

**Planned Enhancements:**
- [ ] Per-user rate limiting (currently IP-based)
- [ ] Advanced tool system with plugin architecture
- [ ] Conversation sharing and collaboration
- [ ] Advanced analytics and usage tracking
- [ ] Cloud storage integration (S3, GCS)
- [ ] Additional AI provider support

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow existing code patterns and conventions
- Write tests for new features
- Run linting before committing: `npm run lint`
- Ensure all tests pass: `npm test`
- Update documentation as needed

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [Next.js](https://nextjs.org/)
- API compatibility with [OpenAI](https://openai.com/)
- Tool orchestration inspired by modern agent frameworks
- UI components powered by [Tailwind CSS](https://tailwindcss.com/)

---

**Note:** This project requires API keys from supported providers. Store them securely in `.env` files and never commit them to version control.