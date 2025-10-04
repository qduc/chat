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
- **🔌 Multi-Provider Support** - OpenAI-compatible interface supporting multiple AI providers with automatic API adapter selection
- **🎨 Modern UI** - React 19 with quality controls, markdown rendering, syntax highlighting, and responsive design
- **🗂️ Prompt Management** - Built-in and custom system prompts with conversation-aware selection
- **🧪 Comprehensive Testing** - Jest test suites for both frontend and backend with integration utilities
- **🐳 Docker Ready** - Development and production Docker configurations with hot reload support

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
# Edit backend/.env and add your OPENAI_API_KEY
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
# Edit backend/.env and add your OPENAI_API_KEY

# Start with hot reload
./dev.sh up --build

# Follow logs
./dev.sh logs -f
```

Visit http://localhost:3003 (dev environment uses different ports)

API requests from the browser can now target `http://localhost:3003/api` via the bundled reverse proxy container.

### Docker Production

```bash
# Ensure API key is set in backend/.env
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
├── frontend/          # Next.js 15 + React 19 + TypeScript
├── backend/           # Node.js + Express + SQLite
├── docs/              # Architecture documentation and ADRs
├── dev.sh             # Development orchestration script
├── prod.sh            # Production management script
├── docker-compose.yml             # Production Docker setup
├── docker-compose.dev.yml         # Development Docker setup
└── package.json       # Root workspace scripts
```

## Development

### Available Scripts

```bash
# Testing
./dev.sh test              # Run all tests
./dev.sh test:backend      # Backend tests only
./dev.sh test:frontend     # Frontend tests only

# Linting
./dev.sh exec backend npm run lint
./dev.sh exec frontend npm run lint

# Database migrations
./dev.sh migrate up        # Apply migrations
./dev.sh migrate down      # Rollback migrations

# Docker management
./dev.sh up --build        # Start dev environment
./dev.sh down              # Stop containers
./dev.sh logs -f           # Follow logs
./dev.sh exec <service> <command>  # Run command in container
```

### Environment Variables

#### Backend (`backend/.env`)

```env
OPENAI_API_KEY=your-api-key-here
TAVILY_API_KEY=your-tavily-key-here  # Optional: for web_search tool
PORT=3001
LOG_LEVEL=info
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
RETENTION_DAYS=30
```

#### Frontend (`frontend/.env.local`)

```env
NEXT_PUBLIC_API_BASE=/api
BACKEND_ORIGIN=http://localhost:3001
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
- Next.js 15 (App Router)
- React 19
- TypeScript
- Tailwind CSS 4
- React Markdown

**Backend:**
- Node.js with ES modules
- Express.js
- SQLite with better-sqlite3
- Pino logging
- node-fetch for provider APIs

### Key Components

- **API Proxy** (`backend/src/routes/chat.js`) - OpenAI-compatible chat completions endpoint
- **Tool Orchestrator** (`backend/src/lib/orchestrators/`) - Server-side tool execution with iterative workflows
- **Persistence Layer** (`backend/src/lib/persistence/`) - SQLite conversation storage
- **Chat State** (`frontend/hooks/useChatState.ts`) - Centralized state management
- **Adapters** (`backend/src/adapters/`) - Provider-specific API implementations (ChatCompletions, Responses API)

### API Endpoints

- `POST /v1/chat/completions` - OpenAI-compatible chat endpoint with streaming support
- `GET /v1/conversations` - List conversations
- `GET /v1/conversations/:id` - Get conversation details
- `DELETE /v1/conversations/:id` - Delete conversation
- `GET /v1/tools` - List available tools
- `GET /v1/providers` - List configured providers
- `GET /v1/system-prompts` - Get system prompts

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

- [x] OpenAI-compatible API proxy with streaming
- [x] Server-side tool orchestration
- [x] Conversation persistence with SQLite
- [x] Modern React UI with real-time streaming
- [x] Docker development environment
- [x] Comprehensive testing infrastructure
- [x] Prompt management system
- [ ] Authentication and authorization
- [ ] Per-user rate limiting
- [ ] Advanced tool system with custom integrations

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