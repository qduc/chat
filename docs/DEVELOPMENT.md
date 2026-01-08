# Development Guide

## Development Scripts

All development commands run in Docker via `./dev.sh` or directly via npm.

### Service Management

#### Docker Development (Recommended)

```bash
./dev.sh up [--build]      # Start services (optionally rebuild)
./dev.sh down              # Stop and remove services
./dev.sh restart           # Restart services
./dev.sh build             # Build service images
./dev.sh ps                # Show service status
```

#### Docker Production

```bash
./prod.sh up [--build]     # Start services (detached, optionally rebuild)
./prod.sh down             # Stop services (requires confirmation)
./prod.sh restart          # Restart services
./prod.sh ps               # Show service status
```

> Production currently runs a single `app` container (built from the root `Dockerfile`) that bundles the Express backend and exported Next.js frontend. When you run `./prod.sh exec`, target the `app` service.

### Logs

#### Development

```bash
./dev.sh logs [-f]         # View logs (optionally follow)
./dev.sh logs -f frontend  # Follow specific service logs
./dev.sh logs -f backend   # Follow backend logs
./dev.sh logs --tail=100   # Show last 100 log lines
```

#### Production

```bash
./prod.sh logs [-f]        # View logs (optionally follow)
./prod.sh health           # Check health status
```

### Testing

#### Running Tests

```bash
# Run all tests
./dev.sh test

# Backend tests only
./dev.sh test:backend

# Frontend tests only
./dev.sh test:frontend

# Run specific test file
./dev.sh test:backend __tests__/conversations.test.js
```

### Database Migrations

#### Development

```bash
./dev.sh migrate status    # Check migration status
./dev.sh migrate up        # Apply pending migrations
./dev.sh migrate fresh     # Reset database (destructive)
```

#### Production

```bash
./prod.sh migrate status   # Check migration status
./prod.sh migrate up       # Apply migrations (with confirmation + auto-backup)
./prod.sh migrate fresh    # Reset database (requires double confirmation)
./prod.sh backup           # Create database backup
```

### Executing Commands in Containers

```bash
# General format
./dev.sh exec <service> <command>

# Examples
./dev.sh exec backend npm run lint
./dev.sh exec frontend npm run build
./dev.sh exec backend npm test
./dev.sh exec backend sh -c "ls -la"
```

### Release Management

```bash
./release.sh               # Interactive release process
./release.sh --dry-run     # Validate without releasing (lint + build)
```

## Local Development (Without Docker)

### Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your configuration
npm run dev
```

### Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env.local
# Edit .env.local with your configuration
npm run dev
```

### Desktop Application Setup (Electron)

```bash
# Build frontend first
cd frontend
npm install
npm run build
cd ..

# Run Electron app
cd electron
npm install
npm start
```

## Development Workflow

### 1. Setting Up Your Environment

1. Copy `.env` files from `.example` versions
2. Configure required variables (see [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md))
3. Run `./dev.sh up --build` or start services locally

### 2. Making Changes

- **Backend**: Changes auto-reload in development mode
- **Frontend**: Changes auto-reload via Next.js HMR
- Check logs with `./dev.sh logs -f` to debug issues

### 3. Testing Changes

```bash
# Run relevant test suite
./dev.sh test:backend
./dev.sh test:frontend

# Run all tests
./dev.sh test
```

### 4. Linting Code

```bash
./dev.sh exec backend npm run lint
./dev.sh exec frontend npm run lint
```

### 5. Building for Production

```bash
./dev.sh exec backend npm run build
./dev.sh exec frontend npm run build
```

## Key Development Tools

### Adminer Database Management

When running Docker development, Adminer is available at http://localhost:3080 for database inspection and management (password-less login for SQLite).

### Upstream API Logging

Request and response logs from the upstream API are stored in `backend/logs/` folder. These files are mounted and accessible without entering the Docker container. Note: these files can be large; typically only read the last dozen lines.

## Code Quality

### Linting

Both frontend and backend have ESLint configured with strict rules:

```bash
./dev.sh exec backend npm run lint
./dev.sh exec frontend npm run lint
```

### Testing

Comprehensive test suites are available:

```bash
# Backend: 45+ test files
# Frontend: Tests for components and utilities
./dev.sh test
```

## Project Structure

For a detailed explanation of the project structure, see the main README or check `docs/backend_code_flow.md` and `docs/frontend_code_flow.md`.

## Troubleshooting

### Services Won't Start

```bash
# Check service status
./dev.sh ps

# View error logs
./dev.sh logs

# Rebuild from scratch
./dev.sh down
./dev.sh up --build
```

### Database Issues

```bash
# Check migration status
./dev.sh migrate status

# Apply pending migrations
./dev.sh migrate up

# Reset database (destructive!)
./dev.sh migrate fresh
```

### Port Conflicts

Development uses port 3003, production uses port 3000. If you have conflicts, modify `docker-compose.dev.yml` or `docker-compose.yml`.

## Next Steps

- See [INSTALLATION.md](INSTALLATION.md) for setup instructions
- Check [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for configuration options
- Read [TOOLS.md](TOOLS.md) for adding new tools
