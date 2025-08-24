# API Specifications

## Chat APIs

### POST /v1/responses (Primary)
The primary chat endpoint supporting conversation continuity.
- **Auth**: None (MVP) → server injects `Authorization: Bearer <OPENAI_API_KEY>`
- **Request**:
  ```jsonc
  {
    "model": "gpt-4.1-mini",
    "messages": [{ "role": "user", "content": "Hello" }],
    "temperature": 0.7,
    "stream": true,
    "previous_response_id": "resp_xyz123"  // Optional: for conversation continuity
  }
  ```
- **Response**:
  - `stream=false`: JSON response matching OpenAI schema with additional `id` field
  - `stream=true`: `text/event-stream` with deltas and `data: [DONE]` termination
  - Response includes `id` field for conversation tracking

### POST /v1/chat/completions (Compatibility)
OpenAI-compatible endpoint for standard chat completions.
- **Auth**: None (MVP) → server injects `Authorization: Bearer <OPENAI_API_KEY>`
- **Request**: Standard OpenAI Chat Completions format
- **Response**: 
  - `stream=false`: Standard OpenAI JSON response
  - `stream=true`: Standard OpenAI SSE format with `data: [DONE]` termination

### Streaming Format (Both Endpoints)
```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"}}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"delta":{"content":" world"}}]}

data: [DONE]
```

## Health & Monitoring

### GET /healthz
Returns system health and configuration.
- **Response**:
  ```json
  {
    "status": "ok",
    "uptime": 12345,
    "provider": "openai-compatible",
    "model": "gpt-4.1-mini"
  }
  ```

## Rate Limiting
- **Current**: In-memory per-IP limiting
- **Headers**: Standard rate limit headers in responses
- **Limits**: Configurable per environment
- **Future**: Redis-based distributed limiting

## Server Features

### Request Processing
- **Proxy Mode**: Direct passthrough to OpenAI-compatible providers
- **Header Injection**: Automatic `Authorization` header from server environment
- **Format Conversion**: Automatic conversion between Responses API and Chat Completions formats
- **Error Handling**: Proper HTTP status codes and error responses

### Logging & Observability
- **Access Logs**: Morgan middleware for HTTP request logging
- **Error Handling**: Structured error responses
- **Performance**: Request timing and basic metrics
- **Privacy**: Input masking for sensitive data (planned)

## Planned Enhancements
- **Authentication**: JWT/API key support with per-user limits
- **Multi-Provider**: Dynamic routing between multiple LLM providers
- **Conversation Persistence**: Database storage for chat history
- **Token Accounting**: Usage tracking and billing integration
- **Observability**: Prometheus metrics and structured logging
