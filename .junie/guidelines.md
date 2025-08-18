# Project Guidelines

## Project Overview
This repository hosts a full‑stack AI chat application (working title: ChatForge). It provides a Next.js/React frontend that talks to a Node/Express backend acting as a thin proxy to an OpenAI‑compatible API. Streaming responses are supported end‑to‑end.

- Vision: Zero‑friction chat UI with pluggable models via an OpenAI‑compatible API.
- Scope (current):
  - Frontend: Next.js chat UI with streaming (done); basic history (pending); attachments (phase 2).
  - Backend: Express proxy with in‑memory rate limit (done); single provider now; auth planned.
- Status: MVP in progress (text‑only, one model, no auth, streaming working).

For the extended overview and an architecture diagram, see docs/OVERVIEW.md.

## Repository Structure (high level)
- frontend/ — Next.js app (React, streaming UI, model selector)
- backend/ — Express API proxy (rate limiting, OpenAI‑compatible request/response)
- docs/ — Project documentation (overview, specs, security, progress, tech stack)
- docker‑compose*.yml — Local/dev orchestration

## How to Run (summary)
See README.md for full instructions. Quick start:
- Local Node (dev):
  1) Copy envs: backend/.env.example → backend/.env; frontend/.env.example → frontend/.env.local
  2) npm --prefix backend install && npm --prefix backend run dev
  3) npm --prefix frontend install && npm --prefix frontend run dev
  Frontend on http://localhost:3000, backend on :3001.
- Docker: docker compose -f docker-compose.yml up --build

## Testing & Build
- There is no dedicated test suite documented yet. If tests are added later, follow instructions in README.md or package scripts.
- Build/packaging is handled via Dockerfiles for both frontend and backend. For dev, use the npm scripts above.

## Code Style
- Use the default tooling configured in each package (e.g., Next.js/TypeScript defaults in frontend; Node/ES modules in backend). If Prettier/ESLint configs are present, follow them; otherwise use conventional formatting.

## Contribution Notes
- Keep changes small and documented. Update relevant items under docs/ and README.md as needed.
- For API changes, ensure the behavior stays OpenAI‑compatible at the proxy boundary.
