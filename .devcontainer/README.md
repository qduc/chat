Dev Container for chat

Overview
- This Dev Container uses Docker Compose to run the existing services and provides a separate "workspace" container for VS Code.

What you get
- Node 20 tooling inside the workspace container
- Frontend (Next.js) on port 3003 -> exposed as 3003
- Backend (Express) on port 4001 -> exposed as 4001
- Postgres on 5432 (internal + published)

How to use
1. Install the "Dev Containers" extension.
2. From this repo, run: Command Palette -> Dev Containers: Reopen in Container.
3. The first time, it will build the images and start services defined in `docker-compose.dev.yml`.
4. The script `.devcontainer/init.sh` will create `backend/.env` (from example) and install deps.
5. After startup, visit:
   - Frontend: http://localhost:3003
   - Backend health: http://localhost:4001/health

Notes
- Change env in `backend/.env`. Never expose provider keys to the frontend.
- To run only the dev servers manually:
  - `npm --prefix backend run dev`
  - `npm --prefix frontend run dev`
