# Backend

Express-based proxy for OpenAI-compatible chat completions.

## Endpoints
- `POST /v1/chat/completions` – proxies to `OPENAI_BASE_URL/chat/completions` (supports streaming)
- `GET /healthz` – health/status info

## Env Vars (.env)
See `.env.example` for required variables.

## Run (Dev)
```bash
cp .env.example .env
npm install
npm run dev
```

## Run with Docker
1. Create env file (not copied into image):
	```bash
	cp .env.example .env
	# edit OPENAI_API_KEY etc.
	```
2. Build & run (from repo root):
	```bash
	docker compose -f docker-compose.yml build backend
	docker compose -f docker-compose.yml up backend
	```
3. Service listens on `localhost:3001`.

Image notes:
- Production image installs only prod deps
- Provide env at runtime (never bake secrets)
- Health check endpoint: `GET /healthz`

## Rate Limiting
Simple in-memory per-IP. Replace with Redis for production scale.

## TODO
- Replace in-memory rate limiter with Redis implementation
- Add structured logging (pino)
- Add request body redaction
- Add tests
- Add graceful shutdown
 - Add Docker healthcheck instruction
