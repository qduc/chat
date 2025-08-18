# ChatForge (working title)

A full-stack AI chat app (React + Node) that talks to an OpenAI-compatible endpoint.

## Current Status
- [x] Bootstrap repo
- [x] Backend proxy with streaming
- [x] Rate limiting (in-memory per-IP)
- [x] Basic chat UI (streaming, model select, abort)
- [ ] Conversation persistence
- [ ] System prompt / temperature controls
- [ ] Auth & per-user limits

## Quick Links
- [Overview](docs/OVERVIEW.md)
- [Progress log](docs/PROGRESS.md)
- [Tech stack](docs/TECH-STACK.md)
- [API specs](docs/API-SPECS.md)
- [Conversation history spec](docs/CONVERSATIONS-SPEC.md)
- [Security & privacy](docs/SECURITY.md)

## Run It
### Option 1: Local (Node)
```bash
# backend
cp backend/.env.example backend/.env
npm --prefix backend install
npm --prefix backend run dev

# frontend
cp frontend/.env.example frontend/.env.local
npm --prefix frontend install
npm --prefix frontend run dev
```
Visit http://localhost:3000 (backend on :3001).

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
