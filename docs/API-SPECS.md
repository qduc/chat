# API Specs (MVP)

## POST /v1/chat/completions
Proxies directly to the configured OpenAI-compatible endpoint.
- Auth: (none for MVP) → server injects `Authorization: Bearer <OPENAI_API_KEY>`
- Request (subset):
  ```jsonc
  {
    "model": "gpt-4.1-mini",
    "messages": [{ "role": "user", "content": "Hello" }],
    "temperature": 0.7,
    "stream": true
  }
  ```
- Response:
  - `stream=false`: JSON response matching OpenAI schema
  - `stream=true`: `text/event-stream` lines: `data: {"id":"...","choices":[{"delta":{"content":"..."}}]}` and a final `data: [DONE]`

### Server-side additions (roadmap)
- Optional `x-user-id` for per-user limits (phase 3)
- Request logging (masked inputs) + token usage summary
- Provider routing (multiple upstreams)

## GET /healthz
- Returns `{ status: "ok", uptime, provider: "openai-compatible" }` and `model` (current default model from env)
