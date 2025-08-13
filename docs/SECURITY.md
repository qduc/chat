# Security & Privacy (working)

## Secrets
- Never expose provider keys to the browser
- Backend uses env: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `DEFAULT_MODEL`

## Data Handling (MVP)
- No transcripts persisted by default
- In dev, logs redact message content; only token counts stored

## Rate Limiting
- Per-IP (MVP), per-user (phase 3)
- Redis window: 60s, 50 req (tune later)

## Threat Notes
- Prompt injection: display untrusted model output; never execute it
- CORS: restrict to app origin in non-dev
- SSRF: backend only calls allowlisted `OPENAI_BASE_URL`
