# Installation Guide

## Prerequisites

- Node.js 18 or higher
- Docker and Docker Compose (for containerized deployment)
- An OpenAI (or compatible) API key that you'll enter via in-app user settings

## Quick Start

### Option 1: Local Development (Node.js)

```bash
# Clone the repository
git clone <repository-url>
cd chat

# Set up backend
cp backend/.env.example backend/.env
# Edit backend/.env and set:
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

### Option 2: Docker Development (Recommended)

```bash
# Copy environment files
cp backend/.env.example backend/.env
# Edit backend/.env and set:
# - JWT_SECRET (a secure random string for authentication)

# Start with hot reload
./dev.sh up --build

# Follow logs
./dev.sh logs -f
```

Visit http://localhost:3003 (dev environment uses different ports)

API requests from the browser can now target `http://localhost:3003/api` via the bundled reverse proxy container.

### Option 3: Docker Production

```bash
# Ensure required variables are set in backend/.env:
# - JWT_SECRET
./prod.sh up --build

# Check service health
./prod.sh health

# View logs
./prod.sh logs -f
```

Visit http://localhost:3000

## Configuration

### Environment Variables

See [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for detailed environment variable documentation.

**Minimal required configuration:**
- `JWT_SECRET` - A secure random string for JWT authentication

Provider API keys, base URLs, and default models are now configured per user inside the product (Settings → Providers & Tools).

## Next Steps

- Check [DEVELOPMENT.md](DEVELOPMENT.md) for development workflow and available commands
- See [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for all configuration options
- Read [ARCHITECTURE.md](ARCHITECTURE.md) for technical architecture details
