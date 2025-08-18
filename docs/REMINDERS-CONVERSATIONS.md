# Reminders — Conversations Persistence Work

This file contains short, actionable reminders for revisiting the Conversations persistence feature when you are ready.

Short-term reminders (when you next work on this):

- Implement `POST /v1/conversations/:id/messages` on the backend to support explicit user message persistence when not using the chat proxy flow.
  - File: `backend/src/routes/conversations.js`
  - DB calls: `getNextSeq`, `insertUserMessage`

- Add unit/integration tests covering:
  - Creating/listing/getting/deleting conversations (SQLite in-memory)
  - Streaming persistence path (assistant draft creation, delta append, finalize)

- Document how to enable persistence locally with SQLite in the main README and in `backend/README.md`.

Mid-term reminders (next sprint):

- Add Postgres support and migrations:
  - Choose a migration/ORM tool: `Kysely` (recommended), `Prisma`, or `Knex`.
  - Implement DB URL parsing to accept `postgres://...` and `file:...`.
  - Add Postgres-safe migrations and test against the `postgres` service in `docker-compose.dev.yml`.
  - For `seq` generation under Postgres, use a database sequence or transactional upsert to avoid race conditions.

- Add token accounting & observability:
  - Record `tokens_in`/`tokens_out` if upstream provides them.
  - Optionally add a lightweight token estimator when upstream doesn't provide counts.

- Privacy & security:
  - Add redaction toggle (strip system prompts) before persisting.
  - Ensure no headers/API keys are persisted.
  - Add user consent/opt-in UI note.

Long-term reminders:

- Add export/import of conversations (JSONL).
- Add per-user auth integration and ACLs.
- Add tests for Postgres persistence and scaling concerns.

How to enable (quick dev note):

- For now enable persistence with SQLite:
  - Set in `backend/.env` or compose env: `PERSIST_TRANSCRIPTS=true` and `DB_URL=file:./backend/data/dev.db`.
  - Start the dev stack: `docker compose -f docker-compose.dev.yml up --build`.

TODO: remove this file when all items above are implemented.
