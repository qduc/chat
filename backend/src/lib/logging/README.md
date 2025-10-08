# Upstream Logging

This module provides logging utilities for capturing and formatting upstream API requests and responses.

## Features

### SSE (Server-Sent Events) Chunk Formatting

When logging upstream responses that use SSE (text/event-stream), the logger now provides both:

1. **Formatted SSE Chunks** - A human-readable summary of each chunk showing:
   - Chunk index
   - Role changes
   - Content text (in quotes for easy reading)
   - Tool calls (formatted JSON)
   - Finish reasons
   - Token usage statistics

2. **Raw SSE Stream** - The complete, unmodified SSE stream for debugging

### Example Output

**Before** (hard to read):
```
data: {"id":"gen-123","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}

data: {"id":"gen-123","choices":[{"index":0,"delta":{"content":" World"},"finish_reason":null}]}

data: [DONE]
```

**After** (easy to scan):
```
Formatted SSE Chunks:
[Chunk 0] Role: assistant, Content: "Hello"
[Chunk 1] Content: " World"
[Chunk 2] STREAM END

--- Raw SSE Stream ---
data: {"id":"gen-123","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}

data: {"id":"gen-123","choices":[{"index":0,"delta":{"content":" World"},"finish_reason":null}]}

data: [DONE]
```

## API

### `logUpstreamRequest({ url, headers, body })`

Logs an upstream API request with sensitive data redacted.

### `logUpstreamResponse({ url, status, headers, body })`

Logs an upstream API response. Automatically detects SSE responses and formats them for readability.

### `formatSSEChunks(bodyStr)`

Formats raw SSE stream data into human-readable chunk summaries.

**Parameters:**
- `bodyStr` (string) - Raw SSE stream body

**Returns:**
- (string) - Formatted chunk summaries

### `teeStreamWithPreview(readable, options)`

Captures a preview of a stream while allowing it to be consumed by other parts of the application.

**Parameters:**
- `readable` - A Node.js readable stream
- `options.maxBytes` - Maximum bytes to capture (default: 64KB)
- `options.encoding` - Text encoding (default: 'utf8')

**Returns:**
- `{ previewPromise, stream }` - Promise resolving to captured preview and passthrough stream

## Configuration

- `UPSTREAM_LOG_DIR` - Directory for log files (default: `/app/logs` or `./logs`)
- `UPSTREAM_LOG_RETENTION_DAYS` - Days to retain logs (default: 7)
- `NODE_ENV` - Set to `test` to disable logging and use isolated temporary directories

### Test Isolation

In test environments (`NODE_ENV=test`):
- Logging is completely disabled by default
- If logging were enabled, it would use unique temporary directories (`/tmp/chat-test-logs/test-{timestamp}-{random}/`)
- This prevents test runs from polluting actual log directories

## Log Files

Logs are written to:
- `upstream-requests-YYYY-MM-DD.log` - Request logs
- `upstream-responses-YYYY-MM-DD.log` - Response logs (formatted for readability)
- `upstream-responses-sse-raw-YYYY-MM-DD.log` - Raw SSE streams (for detailed debugging)

**Note**: For SSE responses, the formatted version is written to `upstream-responses-*.log` for easy reading, while the raw unprocessed stream is written to `upstream-responses-sse-raw-*.log` for detailed debugging. This separation keeps the main response log clean and readable.

Old logs are automatically cleaned up based on retention settings.
