# ChatForge

A full-stack AI chat application with advanced tool orchestration and streaming support. Built with Next.js frontend and Node.js backend, featuring OpenAI-compatible API endpoints with server-side tool calling capabilities.

## Current Status
- [x] Bootstrap repo
- [x] Backend proxy with streaming (OpenAI-compatible)
- [x] Rate limiting (in-memory per-IP)
- [x] Basic chat UI (streaming toggle, model select, abort)
- [x] Responses API with conversation continuity
- [x] Testing infrastructure (Jest for backend & frontend)
- [x] Markdown rendering with syntax highlighting
- [x] Development tooling (ESLint, Prettier)
- [x] Docker development environment
- [x] **Tool orchestration system** (server-side, up to 10 iterations)
- [x] **Enhanced UI components** (quality controls, floating dropdowns)
- [x] **Advanced streaming** (tool events, thinking support)
- [x] **Conversation persistence** (SQLite database with migrations)
- [x] Conversation history UI integration
- [x] System prompt / temperature controls
- [ ] Auth & per-user limits (planned)

## Key Features

### 🤖 **Tool Orchestration**
- Server-side tool calling with unified orchestrator
- Iterative workflows with thinking support
- Supports both streaming and non-streaming modes
- Smart error handling and timeout management

### 🎨 **Enhanced UI**
- Quality slider for response control (quick/balanced/thorough)
- Improved dropdown components with floating UI positioning
- Responsive design with accessibility features
- Real-time streaming with tool event display

### 🔧 **Technical Features**
- OpenAI-compatible API (Chat Completions + Responses)
- SQLite database with migrations for conversation persistence
- Comprehensive test coverage (Jest)
- ESLint/Prettier code quality tools
- Docker development environment with hot reload

## Quick Links
- [Overview](docs/OVERVIEW.md)
- [Progress log](docs/PROGRESS.md)
- [Tech stack](docs/TECH-STACK.md)
- [API specs](docs/API-SPECS.md)
- [Security & privacy](docs/SECURITY.md)

## Run It
### Option 1: Local (Node)
```bash
# backend
cp backend/.env.example backend/.env
npm --prefix backend install
npm --prefix backend run dev

# frontend (in separate terminal)
cp frontend/.env.example frontend/.env.local
npm --prefix frontend install
npm --prefix frontend run dev
```
Visit http://localhost:3000 (backend on :3001).

**Note**: Set `OPENAI_API_KEY` in `backend/.env` before starting. Optionally set `TAVILY_API_KEY` for web search tool functionality.

### Option 2: Docker (Full Stack)
```bash
cp backend/.env.example backend/.env   # ensure API key set
docker compose -f docker-compose.yml up --build
```
Then open http://localhost:3000

Images:
- backend: minimal prod deps only
- frontend: multi-stage (deps → build → runtime) with build-time `NEXT_PUBLIC_API_BASE`

To rebuild frontend with a different API base:
```bash
docker compose build --build-arg NEXT_PUBLIC_API_BASE=http://backend:3001 frontend
docker compose up -d frontend
```

### Option 3: Development Docker (Hot Reload)
```bash
cp backend/.env.example backend/.env   # ensure API key set
docker compose -f docker-compose.dev.yml up --build
```
Frontend on http://localhost:3000 with hot reload enabled.

## Development

### Tool Development
The application includes a server-side tool registry located in `backend/src/lib/tools.js`. To add new tools:

1. Define your tool in the registry with a `validate` function for arguments
2. Implement the `handler` function
3. Tools are automatically available via the orchestration system

Example:
```javascript
export const tools = {
  get_weather: {
    validate: (args) => {
      if (!args || typeof args.city !== 'string') {
        throw new Error('get_weather requires a "city" argument of type string');
      }
      return { city: args.city };
    },
    handler: async ({ city }) => ({ tempC: 22, city }),
  }
};
```

### Testing
```bash
# Backend tests
npm --prefix backend test

# Frontend tests
npm --prefix frontend test
```

### Code Quality
```bash
# Backend linting
npm --prefix backend run lint

# Frontend linting
npm --prefix frontend run lint
```
