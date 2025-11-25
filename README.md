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
- **🔌 Multi-Provider Support** - OpenAI-compatible interface with OpenAI, Anthropic, and Gemini providers
- **🎨 Modern UI** - React 19 with markdown rendering, syntax highlighting, and responsive design
- **🗂️ Prompt Management** - Built-in and custom system prompts with conversation-aware selection
- **🐳 Docker Ready** - Development and production Docker configurations with hot reload support
- **🔐 Authentication & User Management** - JWT-based authentication with registration, login, and refresh tokens
- **👤 User-Scoped Multi-Tenancy** - Per-user provider configuration with isolated conversations and settings
- **🖼️ Image Upload & Vision Support** - Multimodal vision support with drag-and-drop UI
- **📎 File Attachment Support** - Text file upload with content extraction
- **🧠 Reasoning Controls** - Support for reasoning effort and extended thinking modes
- **💾 Prompt Caching Optimization** - Automatic cache breakpoints to reduce token costs
- **📓 Journal Tool** - Persistent memory tool for cross-conversation AI memory

## Prerequisites

- Node.js 18 or higher
- Docker and Docker Compose (for containerized deployment)
- An OpenAI (or compatible) API key that you'll enter through Settings → Providers & Tools

## Quick Start

### Option 1: One-Click Docker Hub Deployment (Recommended)

Pull pre-built images from Docker Hub - no cloning required:

```bash
# Download the compose file
curl -O https://raw.githubusercontent.com/qduc/chat/main/docker-compose.hub.yml

# (Optional) Provide infrastructure secrets
echo "JWT_SECRET=change-me" > .env

# Start the stack
docker compose -f docker-compose.hub.yml up -d
```

Visit http://localhost:3000, register your first user, then open **Settings → Providers & Tools** to enter your API key and base URL.

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

Visit http://localhost:3003

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
├── docs/              # Technical documentation
├── proxy/             # Nginx reverse proxy config
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

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Follow existing code patterns and conventions
2. Write tests for new features
3. Run linting: `./dev.sh exec backend npm run lint`
4. Ensure all tests pass: `./dev.sh test`
5. Update documentation as needed

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
