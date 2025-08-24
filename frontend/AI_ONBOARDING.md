# AI Agent Onboarding Guide

## Project Overview
OpenAI-compatible chat interface with Next.js frontend and Node.js backend proxy.

## Architecture
```
Frontend (Next.js) ←→ Backend (Express) ←→ LLM Provider (OpenAI-compatible)
```

## Key Directories
- `frontend/` - Next.js 15, React 19, Tailwind v4, TypeScript
- `backend/` - Node.js/Express, SQLite (better-sqlite3), ESM modules  
- `docs/` - Architecture decisions, API specs, development notes

## Core Components
- `frontend/components/Chat.tsx` - Main chat interface with streaming
- `frontend/lib/chat.ts` - SSE streaming client logic
- `backend/src/routes/chat.js` - OpenAI proxy with rate limiting
- `backend/src/db/` - SQLite database layer

## Development Commands

### Local Development
- Frontend: `cd frontend && npm run dev` (port 3000)
- Backend: `cd backend && npm run dev` (port 8080)  

### Docker Development
Docker provides a consistent environment and eliminates the need for local Node.js setup.

**Production-like Environment:**
```bash
# Build and start both services
docker-compose up --build

# Access services
# Frontend: http://localhost:3000
# Backend: http://localhost:3001 (via frontend proxy at /api)
```

**Development Environment (recommended):**
```bash
# Using the convenience script
./dev.sh up --build

# Or directly with docker-compose
docker-compose -f docker-compose.dev.yml up --build

# Access services
# Frontend: http://localhost:3003 (with hot reload)
# Backend: http://localhost:4001 (with hot reload)
# PostgreSQL: localhost:5432 (for future use)
```

**Docker Management:**
```bash
# View logs
./dev.sh logs -f frontend    # Frontend logs only
./dev.sh logs               # All service logs

# Check service status
./dev.sh ps

# Restart services
./dev.sh restart

# Execute commands in containers
./dev.sh exec backend npm test       # Run tests in backend container
./dev.sh exec frontend npm run build # Build frontend in container
./dev.sh exec backend npm install    # Install dependencies
./dev.sh exec frontend npm run lint  # Run linting
./dev.sh exec backend sh -c "ls -la" # Run shell commands (non-interactive)

# Stop and cleanup
./dev.sh down
```

**Key Docker Features:**
- **Hot reload**: Source code mounted as volumes for instant updates
- **Isolated networking**: Services communicate via Docker network
- **Environment consistency**: Same Node.js/npm versions across machines
- **PostgreSQL ready**: Database service included for future features

## Testing
- Frontend: Jest/RTL tests in `frontend/__tests__/`
- Backend: Basic tests in `backend/__tests__/`
- Run: `npm test` in respective directories

## Key Features
- ✅ Streaming chat with SSE
- ✅ Basic conversation history
- ✅ Rate limiting (in-memory)
- ⏳ Multi-model support (UI ready, backend static)
- ⏳ Authentication (planned)

## Environment Setup
- Backend needs `OPENAI_API_KEY` and `OPENAI_BASE_URL`
- Frontend uses `NEXT_PUBLIC_API_BASE` for backend URL
- See `.env.example` files for full config

## Code Patterns
- Backend: ESM modules, Express middleware, OpenAI passthrough
- Frontend: React hooks, Tailwind classes, TypeScript strict mode
- Database: SQLite with better-sqlite3, migrations in `db/index.js`

## Current Status
MVP phase - basic chat working, multi-model and auth planned next.