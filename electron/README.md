# ChatForge Electron App

This directory contains the configuration to package ChatForge as a standalone Electron application.

## Prerequisites

- Node.js 20+
- NPM

## Setup

1.  **Build the Frontend**:
    The Electron app serves the static export of the frontend. You must build it first.
    ```bash
    cd frontend
    npm install
    npm run build
    cd ..
    ```

2.  **Install Electron Dependencies**:
    ```bash
    cd electron
    npm install
    ```

## Running in Development

To run the Electron app in development mode (using the local backend and frontend build):

```bash
cd electron
npm start
```

Note: In development mode, the app tries to load `http://localhost:3000` first (if you are running `next dev`), otherwise it falls back to `../frontend/out/index.html`.

## Packaging for Distribution

To create a distributable application (dmg, exe, deb, etc.):

```bash
cd electron
npm run dist
```

The output will be in `electron/dist`.

## Architecture

- **Main Process**: `electron/main.js` orchestrates the application.
- **Backend**: The existing Express backend (`backend/src`) is imported and run directly within the Electron main process (or as a child process). It listens on port 3001.
- **Frontend**: The Next.js frontend is exported as a static site (`frontend/out`) and served via `file://` protocol.
- **Database**: SQLite database is stored in the user's application data directory (e.g., `~/Library/Application Support/ChatForge/chat.sqlite` on macOS).

## Configuration

The Electron app sets the following environment variables for the backend:
- `PORT`: 3001
- `DATA_DIR`: User's application data directory.
- `DB_URL`: `file:<DATA_DIR>/chat.sqlite`
- `SKIP_AUTO_START`: true (to prevent backend from auto-starting on import)
