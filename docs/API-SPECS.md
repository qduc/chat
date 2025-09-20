# API Specifications

## Chat APIs
> **Note:** All conversation history, including tool outputs and reasoning steps, is persisted in a SQLite database for continuity and auditability.

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
    "previous_response_id": "resp_xyz123",  // Optional: for conversation continuity
    "tools": [...],                         // Optional: enable tool usage
    "research_mode": true                   // Optional: enable research mode for multi-step tool usage
  }
  ```
- **Response**:
  - `stream=false`: JSON response matching OpenAI schema with additional `id` field
  - `stream=true`: `text/event-stream` with deltas and `data: [DONE]` termination
  - Response includes `id` field for conversation tracking

### POST /v1/chat/completions (Compatibility)
OpenAI-compatible endpoint for standard chat completions.
- **Auth**: None (MVP) → server injects `Authorization: Bearer <OPENAI_API_KEY>`
- **Request**: Standard OpenAI Chat Completions format with additional optional fields:
  ```jsonc
  {
    "model": "gpt-4.1-mini",
    "messages": [...],
    "tools": [...],           // Optional: enable tool usage
    "research_mode": true     // Optional: enable research mode for multi-step tool usage
  }
  ```
- **Response**:
  - `stream=false`: Standard OpenAI JSON response
  - `stream=true`: Standard OpenAI SSE format with `data: [DONE]` termination

### Tool Usage and Research Mode

#### Tool Usage
When `tools` array is provided, the system can execute server-side tools during the conversation:
 Available tools: `get_time`, `web_search`, and any additional tools defined in the server registry (see `backend/src/lib/tools.js`). Tools can be added by extending the registry with validation schemas and handler functions. Tool inputs are validated server-side for safety and correctness.

#### Research Mode
When `research_mode: true` is set with tools, the system enables multi-step research capabilities:

**Iterative Orchestration:**
 When `research_mode: true` is enabled, the AI can perform up to 10 tool calls per request, streaming its reasoning and tool outputs between steps. The orchestration system adapts to both streaming and non-streaming requests.
 Tool execution is server-side, with input validation and error handling. Tool results are persisted as part of the conversation history.

**Research Mode Streaming**: Includes additional event types:
```
data: {"id":"iter_123","choices":[{"delta":{"content":"Let me search for that information..."}}]}

data: {"id":"iter_123","choices":[{"delta":{"tool_calls":[{"id":"call_abc","function":{"name":"web_search","arguments":"{\"query\":\"AI developments 2024\"}"}}]}}]}

data: {"id":"iter_123","choices":[{"delta":{"tool_output":{"tool_call_id":"call_abc","name":"web_search","output":"Search results..."}}}]}

data: {"id":"iter_123","choices":[{"delta":{"content":"Based on the results, let me search for more specific information..."}}]}
```

### Streaming Format (Both Endpoints)

Streaming events include:
```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"}}]}
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"delta":{"content":" world"}}]}
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"id":"call_abc","function":{"name":"web_search","arguments":"{\"query\":\"AI developments 2024\"}"}}]}]}}
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"delta":{"tool_output":{"tool_call_id":"call_abc","name":"web_search","output":"Search results..."}}}]}
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"delta":{"content":"Based on the results, let me search for more specific information..."}}]}
data: [DONE]
```

Tool events (`tool_calls`, `tool_output`) and reasoning events are streamed in real-time. All tool outputs and reasoning steps are persisted as part of the conversation history.

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
 - **Current**: In-memory per-IP sliding window limiting (configurable via `RATE_LIMIT_WINDOW_SEC` and `RATE_LIMIT_MAX`)
 - **Headers**: Standard rate limit headers in responses
 - **Limits**: Configurable per environment
 - **Planned**: Redis-backed per-user and per-key limits for production scaling

## Server Features

### Request Processing
- **Proxy Mode**: Direct passthrough to OpenAI-compatible providers
- **Header Injection**: Automatic `Authorization` header from server environment
- **Format Conversion**: Automatic conversion between Responses API and Chat Completions formats
 - **Error Handling**: Structured error responses with proper HTTP status codes. Tool failures and upstream errors are handled gracefully, with error details persisted in conversation history. Input validation and timeouts are enforced for all tool executions.

### Logging & Observability
- **Access Logs**: Morgan middleware for HTTP request logging
 - **Error Handling**: Structured error responses. Tool errors and upstream failures are logged and persisted for observability and debugging.
- **Performance**: Request timing and basic metrics
- **Privacy**: Input masking for sensitive data (planned)

## Planned Enhancements
 - **Authentication**: JWT/API key support with per-user limits
 - **Multi-Provider**: Dynamic routing between multiple LLM providers
 - **Token Accounting**: Usage tracking and billing integration
 - **Observability**: Prometheus metrics and structured logging
 - **Conversation UI**: Frontend integration for conversation history browsing
 - **System Prompt & Temperature Controls**: UI and backend support for system prompt and temperature settings
 - **File Uploads & Attachments**: Support for file uploads and attachments in chat
 - **Token Usage Display**: Show token usage and cost estimates in UI
