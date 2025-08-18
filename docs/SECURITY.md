
# Security & Privacy (working)

## Secrets
- Never expose provider keys to the browser.
- Backend uses these env vars (see `backend/.env.example` and `backend/src/env.js`):
	- `OPENAI_BASE_URL`
	- `OPENAI_API_KEY`
	- `DEFAULT_MODEL`
	- `PORT`
	- `RATE_LIMIT_WINDOW_SEC`
	- `RATE_LIMIT_MAX`
	- `ALLOWED_ORIGIN`

## Data Handling (MVP)
- No transcripts are persisted by default.
- Logging and telemetry: the server currently uses `morgan` for request logging and does not persist request bodies or token usage. Automatic redaction of message content and token-count recording are NOT implemented yet and are planned features.

## Rate Limiting
- Current implementation: in-memory, per-IP sliding window (MVP).
- Planned: Redis-backed per-user and per-key limits for production.

## Threat Notes
- Prompt injection: treat model output as untrusted; do not execute or evaluate model output as code.
- CORS: backend `ALLOWED_ORIGIN` should be set to restrict allowed origins in non-dev environments.
- SSRF: the service forwards requests to the configured `OPENAI_BASE_URL`. There is no additional URL allowlist enforcement beyond using the configured base URL; restrict `OPENAI_BASE_URL` in deployment to mitigate SSRF risks.

```
