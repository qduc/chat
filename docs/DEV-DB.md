# Development Postgres (docker-compose.dev.yml)

This project includes a Postgres service in `docker-compose.dev.yml` for local development of the conversations persistence feature.

How it works

- Service name: `postgres` (image `postgres:15-alpine`).
- Database: `chatforge`
- User: `postgres`
- Password: `postgres`
- Data volume: `db_data` (persisted on host by Docker)

Backend wiring

The `backend` service in `docker-compose.dev.yml` has been wired with the following environment defaults for local development:

- `PERSIST_TRANSCRIPTS=1` — enables persistence for testing the feature.
- `DB_URL=postgres://postgres:postgres@postgres:5432/chatforge` — connection string pointing at the `postgres` service.
- `RETENTION_DAYS=30`
- `HISTORY_BATCH_FLUSH_MS=250`
- `MAX_CONVERSATIONS_PER_SESSION=100`
- `MAX_MESSAGES_PER_CONVERSATION=1000`

Starting the stack

From the repository root run:

```bash
# start dev stack (frontend, backend, postgres)
docker compose -f docker-compose.dev.yml up --build
```

Notes

- The backend also reads `./backend/.env`; variables set in that file will override the `environment` declared in compose where applicable.
- For a clean DB, remove the volume first: `docker volume rm chat_db_data` (adjust name according to `docker volume ls`).
- This setup is for local development only; do not use these credentials in production.
