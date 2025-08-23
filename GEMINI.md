# Gemini Agent Onboarding

This document provides essential information for the Gemini agent to effectively contribute to the ChatForge codebase. It is kept in sync with `AI_ONBOARDING.md`.

## Project Overview

ChatForge is a full-stack AI chat application featuring a React-based frontend and a Node.js backend. It is designed to communicate with any OpenAI-compatible API endpoint.

**Architecture:**
```
Frontend (Next.js) ←→ Backend (Express) ←→ LLM Provider (OpenAI-compatible)
```

## Tech Stack

### Frontend
- **Framework:** Next.js (v15) with App Router
- **Language:** TypeScript
- **UI Library:** React (v19)
- **Styling:** Tailwind CSS (v4)

### Backend
- **Runtime:** Node.js (v20) with ES Modules (ESM)
- **Framework:** Express.js
- **Database:** `better-sqlite3` for MVP. PostgreSQL is available in the dev environment for future use.

### Infrastructure
- **Containerization:** Docker and Docker Compose are used for both development and production.
- **Development Helper:** A `dev.sh` script simplifies Docker Compose commands.

## Development Commands

The recommended development environment uses Docker to ensure consistency.

### Docker Development (Recommended)
This setup uses `docker-compose.dev.yml` and provides hot-reloading for both frontend and backend.

1.  **Configure Environment:**
    ```bash
    cp backend/.env.example backend/.env
    ```
    Ensure the `OPENAI_API_KEY` is set in the `.env` file.

2.  **Build and Run:**
    ```bash
    # Using the convenience script (recommended)
    ./dev.sh up --build

    # Or directly with docker-compose
    docker-compose -f docker-compose.dev.yml up --build
    ```

3.  **Access Services:**
    - **Frontend:** `http://localhost:3003` (with hot reload)
    - **Backend:** `http://localhost:4001` (with hot reload)
    - **PostgreSQL:** `localhost:5432` (for future use)

### Docker Management (`dev.sh`)
- **View logs:** `./dev.sh logs -f frontend` or `./dev.sh logs`
- **Check status:** `./dev.sh ps`
- **Restart services:** `./dev.sh restart`
- **Execute commands:** `./dev.sh exec backend npm test`
- **Stop and cleanup:** `./dev.sh down`

### Local Node.js Development
This method is an alternative if you are not using Docker.

1.  **Backend Setup:** (`http://localhost:3001`)
    ```bash
    cp backend/.env.example backend/.env
    npm --prefix backend install
    npm --prefix backend run dev
    ```
2.  **Frontend Setup:** (`http://localhost:3000`)
    ```bash
    cp frontend/.env.example frontend/.env.local
    npm --prefix frontend install
    npm --prefix frontend run dev
    ```

## Project Structure
- **`backend/`**: Node.js Express application.
  - **`src/db/`**: Database logic (`better-sqlite3`).
  - **`src/lib/`**: Core logic (e.g., OpenAI proxy).
  - **`src/routes/`**: API route definitions.
  - **`__tests__/`**: Backend tests.
- **`frontend/`**: Next.js application.
  - **`app/`**: App Router pages and layouts.
  - **`components/`**: Reusable React components (`Chat.tsx`).
  - **`lib/`**: Client-side logic (`chat.ts`).
  - **`__tests__/`**: Frontend tests.
- **`docs/`**: Project documentation (API specs, ADRs).
- **`.devcontainer/`**: VS Code development container configuration.

## Testing
- Tests are located in `frontend/__tests__` and `backend/__tests__`.
- The command to run them is `npm test` in the respective directories.
- **Note:** The backend `test` script is currently not fully implemented in `package.json`.

## API Endpoints

### `POST /v1/chat/completions`
- **Description:** Proxies chat requests to the OpenAI-compatible endpoint.
- **Streaming:** Supports `text/event-stream`.
- **Authentication:** The server injects the `Authorization` header.

### `GET /healthz`
- **Description:** Returns the health status of the backend service.