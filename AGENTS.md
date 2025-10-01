# AI Onboarding Guide

This document provides essential knowledge for AI agents to be immediately productive in this codebase.

## Project Overview

**ChatForge** is a modern chat application with a Next.js frontend and Node.js backend, designed as an OpenAI API proxy with enhanced features like conversation persistence, tool orchestration, and multi-provider support.

## Architecture Overview

### High-Level Structure
```
chat/
  frontend/             # Next.js frontend
  backend/              # Node.js backend
  docs/                 # Architecture docs and ADRs
  dev.sh                # Development orchestration script
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

### Core Design Principles

1. **User-Based Data Isolation**: All data operations are scoped to authenticated users
2. **Server-Side Tool Orchestration**: Tools execute on the backend, not client
3. **OpenAI API Compatibility**: Backend presents OpenAI-compatible interface while adding features
4. **Real-time Streaming**: SSE-based streaming for chat and tool execution

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

### Logs and Monitoring
```bash
./dev.sh logs -f         # Follow logs from all services
./dev.sh logs -f frontend # Follow frontend logs only
./dev.sh logs -f backend  # Follow backend logs only
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
- Tools can execute in parallel when supported
- Backend expands simplified tool names to full specifications

**Database Philosophy**:
- User-based data isolation at query level
- Migration-driven schema evolution
- Automatic cleanup for data retention

### Frontend Patterns

**State Management Philosophy**:
- Single source of truth via reducer pattern
- Optimistic updates with server reconciliation
- URL state synchronization for navigation

**API Integration Philosophy**:
- Centralized HTTP client for consistent error handling
- Streaming and non-streaming modes handled transparently
- Authentication state drives UI and API behavior

**Component Philosophy**:
- Separation between container and presentational components
- Tool visualization integrated into message rendering
- Authentication-aware UI components

## Core Conventions

### Adding New Features

**Backend Routes**: Create in routes directory, apply auth middleware where needed, register in main server file

**Tools**: Follow modular tool pattern, register in tool system, ensure validation and error handling

**Frontend Components**: Follow existing patterns, use centralized HTTP client, respect authentication boundaries

**Database Schema**: Use migrations, maintain user isolation, follow existing table patterns

**Testing**: Match existing test patterns, include authentication context, use provided test utilities

### Universal Rules

- **Authentication**: Always check user authentication for data operations
- **Error Handling**: Use structured error responses, sanitize upstream errors
- **Logging**: Structured logging for debugging and monitoring
- **Type Safety**: TypeScript strict mode on frontend, JSDoc or validation on backend
- **Testing**: Write tests before committing, both services must pass

## Important Architectural Decisions

- **Provider Adapters**: System automatically selects appropriate API adapter based on upstream provider URL
- **Tool Execution**: Always server-side, never client-side
- **Data Isolation**: All queries filtered by authenticated user
- **Streaming Protocol**: SSE for real-time updates
- **API Compatibility**: Maintains OpenAI API contract while extending functionality

## Finding Your Way Around

**Route definitions**: Look in `backend/src/routes/`
**Tool implementations**: Look in `backend/src/lib/tools/`
**State management**: Check `frontend/hooks/` for React hooks
**API clients**: Check `frontend/lib/` for HTTP and chat clients
**Database schema**: Check migration files in `backend/scripts/`
**UI components**: Check `frontend/components/` organized by feature
**Documentation**: Check `docs/` for ADRs and detailed specs

## Instructions for Claude/Copilot AI

- Creating documents after finishing a task is not necessary and should only be done if requested.

---

This architecture prioritizes **separation of concerns**, **type safety**, and **user data isolation** while maintaining **OpenAI API compatibility** and **production reliability**.