
# Security & Privacy

## Secrets
- Never expose provider keys to the browser.
- Backend uses these env vars (see `backend/.env.example` and `backend/src/env.js`):
	- `PROVIDER` (default: openai)
	- `PROVIDER_BASE_URL` / `OPENAI_BASE_URL`
	- `PROVIDER_API_KEY` / `OPENAI_API_KEY`
	- `TAVILY_API_KEY` (for web search tool)
	- `EXA_API_KEY` (for web_search_exa tool)
	- `DEFAULT_MODEL`
	- `TITLE_MODEL`
	- `PORT`
	- `RATE_LIMIT_WINDOW_SEC`
	- `RATE_LIMIT_MAX`
	- `ALLOWED_ORIGIN`
	- `LOG_LEVEL` and `LOG_PRETTY`

## Data Handling
- **Conversation persistence**: SQLite database stores conversation history with proper indexing
- **Tool data**: Tool execution results are persisted as part of conversation history
- **Logging**: Server uses structured logging (pino) with configurable levels
- **Privacy**: Request bodies and tool outputs are stored in database; implement retention policies as needed
- **Redaction**: Automatic content redaction is not implemented; manual review recommended for sensitive data

## Rate Limiting
- Current implementation: in-memory, per-IP sliding window with configurable limits
- Configured via `RATE_LIMIT_WINDOW_SEC` and `RATE_LIMIT_MAX`
- Planned: Redis-backed per-user and per-key limits for production scaling

## Tool Security
- **Server-side execution**: All tools execute server-side to prevent client-side code injection
- **Input validation**: Zod schemas validate all tool inputs before execution
- **API keys**: External tool APIs (Tavily) require separate API keys, never exposed to clients
- **Timeouts**: Tool execution has proper timeout handling to prevent hanging requests
- **Error handling**: Tool failures are gracefully handled without exposing internal details

## Threat Notes
- **Prompt injection**: Treat model output as untrusted; do not execute or evaluate model output as code
- **Tool injection**: While tools are server-side, validate all tool inputs and sanitize outputs
- **CORS**: backend `ALLOWED_ORIGIN` should be set to restrict allowed origins in non-dev environments
- **SSRF**: The service forwards requests to configured provider URLs; restrict provider URLs in deployment
- **Database**: SQLite file should be properly secured with filesystem permissions
- **Logs**: Structured logs may contain conversation data; secure log storage and rotation
