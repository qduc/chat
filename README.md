# ChatForge

> A modern AI chat application with advanced tool orchestration and OpenAI-compatible API proxy

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](https://www.docker.com)

ChatForge is a full-stack AI chat application featuring a Next.js 15 frontend and Node.js backend. It acts as an OpenAI-compatible API proxy with enhanced capabilities including conversation persistence, server-side tool orchestration, multi-provider support, model comparison mode, conversation forking, and cross-platform desktop app support.

<img width="1384" height="1005" alt="Screenshot_20251226_222543" src="https://github.com/user-attachments/assets/51b5ee8b-58be-4e1d-a674-b0a202c8b03b" />

## Features

### Core Capabilities
- **🤖 Server-Side Tool Orchestration** - Unified tool calling with iterative workflows, thinking support, parallel execution, and intelligent error handling
- **💬 Real-Time Streaming** - Server-Sent Events (SSE) with tool execution visibility and abort support
- **💾 Conversation Persistence** - SQLite-backed storage with automatic retention cleanup and migration system
- **🔌 Multi-Provider Support** - OpenAI-compatible interface with OpenAI, Anthropic, and Gemini providers
- **🎨 Modern UI** - React 19 with markdown rendering, syntax highlighting, code wrapping, HTML preview, and responsive design
- **🗂️ Prompt Management** - Built-in and custom system prompts with conversation-aware selection

### Advanced Features
- **🔀 Model Comparison Mode** - Side-by-side comparison of multiple models with isolated conversation histories
- **🍴 Conversation Forking** - Fork conversations at any message to explore alternative paths
- **⚡ Parallel Tool Execution** - Configurable concurrent tool execution for improved performance
- **🌐 Enhanced WebFetch** - Playwright-based browser automation with SPA support and specialized extractors for Reddit, StackOverflow
- **🔄 Streaming Control** - Abort streaming responses with automatic checkpoint persistence
- **💾 Draft Persistence** - Automatic draft message saving across sessions
- **🖥️ Desktop App** - Cross-platform Electron app with auto-login and native packaging
- **🔗 Linked Conversations** - Support for conversation linking and retrieval in context

### Infrastructure & Security
- **🐳 Docker Ready** - Development and production Docker configurations with hot reload support
- **🔐 Authentication & User Management** - JWT-based authentication with registration, login, and refresh tokens
- **👤 User-Scoped Multi-Tenancy** - Per-user provider configuration with isolated conversations and settings
- **🔁 Retry Logic** - Exponential backoff for API calls with configurable retry strategy
- **✅ Code Quality** - Husky pre-commit hooks enforce linting before commits
- **🔔 Toast Notifications** - User-facing notifications for errors and success messages

### AI Capabilities
- **🖼️ Image Upload & Vision Support** - Multimodal vision support with drag-and-drop UI
- **🎙️ Audio Upload Support** - Upload and send audio files for voice-enabled models
- **📎 File Attachment Support** - Text file upload with content extraction
- **🧠 Reasoning Controls** - Support for reasoning effort and extended thinking modes
- **💾 Prompt Caching Optimization** - Automatic cache breakpoints to reduce token costs
- **📓 Journal Tool** - Persistent memory tool for cross-conversation AI memory
- **🎯 Model Caching** - Background refresh and batch fetching for optimal performance

## Prerequisites

- Node.js 18 or higher
- Docker and Docker Compose (for containerized deployment)
- An OpenAI (or compatible) API key that you'll enter through Settings → Providers & Tools

## Quick Start

### Option 1: One-Click Docker Hub Deployment (Recommended)

Pull pre-built images from Docker Hub - no cloning required:

**With Docker Compose:**

Download it from this repository

```bash
curl -O https://raw.githubusercontent.com/qduc/chat/main/docker-compose.yml
```

or create it manually

```yml
services:
  app:
    image: qduc/chat:latest
    environment:
      - IMAGE_STORAGE_PATH=/data/images
      - FILE_STORAGE_PATH=/data/files
      - DB_URL=file:/data/prod.db
    volumes:
      - chatforge_data:/data
      - chatforge_logs:/app/logs
    ports:
      - "${PORT:-3000}:3000"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/health').then(res => { if (res.ok) process.exit(0); process.exit(1); }).catch(() => process.exit(1));"]
      interval: 30s
      timeout: 10s
      start_period: 30s
      retries: 3

volumes:
  chatforge_data:
    driver: local
  chatforge_logs:
    driver: local
```

Then run:

```bash
# Start the stack
docker compose up -d
```

**Or with Docker run (one-liner):**

```bash
docker run -d --name chatforge -p 3000:3000 -v chatforge_data:/data -v chatforge_logs:/app/logs -e DB_URL=file:/data/prod.db qduc/chat:latest
```

Visit http://localhost:3000, register your first user, then open **Settings → Providers & Tools** to enter your API key and base URL.

The production compose file now runs a single `app` service built from the root multi-stage `Dockerfile`. That container bundles the Express API, the exported Next.js UI, and the static asset server, so there is no longer a separate frontend or nginx proxy to operate in production.

**Optional infrastructure config** (add to `.env` file):
```bash
JWT_SECRET=your-secret-here        # Overrides auto-generated secret
PORT=3000                          # External port (default: 3000)
```

### Option 2: Docker Development (with hot reload)

```bash
# Clone the repository
git clone https://github.com/qduc/chat.git && cd chat

# Copy environment files
cp backend/.env.example backend/.env
# Edit backend/.env and set JWT_SECRET

# Start with hot reload
./dev.sh up --build

# Follow logs
./dev.sh logs -f
```

Visit http://localhost:3003. The development compose file still runs dedicated `frontend`, `backend`, and `proxy` containers to keep hot reload fast, but production images collapse into a single runtime service.

For alternative setup options, see [docs/INSTALLATION.md](docs/INSTALLATION.md).

## Documentation

Quick reference:

- **[Installation Guide](docs/INSTALLATION.md)** - Setup instructions for local, Docker dev, and production
- **[Development Guide](docs/DEVELOPMENT.md)** - Development scripts, testing, and workflow
- **[Environment Variables](docs/ENVIRONMENT_VARIABLES.md)** - Complete configuration reference
- **[Architecture](docs/ARCHITECTURE.md)** - Tech stack, components, and design principles
- **[Tool Development](docs/TOOLS.md)** - Guide for adding new tools
- **[API Specification](docs/backend_api_spec.md)** - Complete API endpoint documentation
- **[Backend Code Flow](docs/backend_code_flow.md)** - Request handling and server architecture
- **[Frontend Code Flow](docs/frontend_code_flow.md)** - UI state management and component architecture
- **[Tool Orchestration](docs/tool_orchestration_deep_dive.md)** - Deep dive into the tool system
- **[AI Agent Guide](AGENTS.md)** - Onboarding guide for AI assistants

## Project Structure

```
chat/
├── frontend/          # Next.js 15 + React 19 + TypeScript
├── backend/           # Node.js + Express + SQLite
├── electron/          # Electron desktop app packaging
├── docs/              # Technical documentation
├── proxy/             # Dev-only Nginx reverse proxy config
├── integration/       # Integration tests
├── requests/          # HTTP request examples
├── dev.sh             # Development orchestration
├── prod.sh            # Production management
└── release.sh         # Release management
```

## Testing

```bash
./dev.sh test              # Run all tests
./dev.sh test:backend      # Backend tests only
./dev.sh test:frontend     # Frontend tests only
```

## Deployment Architecture

- **Production (`docker-compose.yml`, `prod.sh`)** – Single `app` container generated by the top-level `Dockerfile`. The multi-stage build compiles the Next.js frontend to a static export and copies it into the Express backend, which serves both `/api` and the UI while persisting data/logs under `/data`.
- **Development (`docker-compose.dev.yml`, `dev.sh`)** – Dedicated `frontend`, `backend`, `proxy`, and `adminer` services for fast iteration with hot reload. The nginx proxy that provides the http://localhost:3003 origin only exists in this dev stack.

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Follow existing code patterns and conventions
2. Write tests for new features
3. Run linting: `./dev.sh exec backend npm run lint`
4. Ensure all tests pass: `./dev.sh test`
5. Update documentation as needed

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
