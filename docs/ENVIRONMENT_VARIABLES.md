# Environment Variables Reference

## Backend (`backend/.env`)

### Required

```env
JWT_SECRET=your-secret-key-here           # Secret for JWT authentication (required)
```

### Optional - Core Settings

```env
PORT=3001                                  # Server port
RATE_LIMIT_WINDOW_SEC=60                   # Rate limit window in seconds
RATE_LIMIT_MAX=500                         # Max requests per window
ALLOWED_ORIGIN=http://localhost:3000       # CORS allowed origin
```

> **Note:** Provider API keys, base URLs, and default model selections now live in user settings.
> Configure them through the app (Settings → Providers & Tools); they are no longer read from `.env` files.

### Optional - Timeouts

```env
PROVIDER_TIMEOUT_MS=10000                  # Provider operation timeout (ms)
PROVIDER_MODEL_FETCH_TIMEOUT_MS=3000       # Model fetching timeout (ms)
PROVIDER_STREAM_TIMEOUT_MS=300000          # Streaming timeout (ms)
```

### Optional - Logging

```env
LOG_LEVEL=debug                            # Logging verbosity (trace/debug/info/warn/error/fatal), default: debug (dev) / info (prod)
LOG_PRETTY=true                            # Human-friendly log formatting, default: true (dev) / false (prod)
LOGS_DIR=./logs                            # Directory for logs
MAX_LOG_RETENTION_DAYS=3                   # Days to retain logs
```

### Optional - Upstream Logging

```env
UPSTREAM_LOG_RETENTION_DAYS=2              # Days to retain upstream logs
UPSTREAM_LOG_MAX_LINES=1000                # Max lines per log file
UPSTREAM_LOG_DIR=./logs                    # Upstream log directory
```

### Optional - Persistence

```env
PERSIST_TRANSCRIPTS=true                   # Enable conversation persistence
DB_URL=                                    # Database URL (defaults to SQLite)
RETENTION_DAYS=30                          # Days to retain conversations
MAX_CONVERSATIONS_PER_SESSION=100          # Conversation limit per session
MAX_MESSAGES_PER_CONVERSATION=1000         # Message limit per conversation
HISTORY_BATCH_FLUSH_MS=250                 # Batch flush interval (ms)
CHECKPOINT_ENABLED=true                    # Enable incremental checkpointing (draft messages + checkpoints)
CHECKPOINT_INTERVAL_MS=3000                # Milliseconds between time-based checkpoints
CHECKPOINT_MIN_CHARACTERS=500              # Content length growth required to checkpoint
```

### Optional - Storage

```env
IMAGE_STORAGE_PATH=./data/images           # Local image storage path
FILE_STORAGE_PATH=./data/files             # Local file storage path
```

### Optional - JWT

```env
JWT_EXPIRES_IN=1h                          # JWT token expiration
JWT_REFRESH_EXPIRES_IN=7d                  # Refresh token expiration
```

### Optional - Retry Logic

```env
RETRY_MAX_ATTEMPTS=3                       # Max retry attempts for API calls
RETRY_INITIAL_DELAY_MS=1000                # Initial backoff delay (ms)
RETRY_MAX_DELAY_MS=60000                   # Max backoff delay (ms)
```

### Optional - Parallel Tool Execution

```env
ENABLE_PARALLEL_TOOL_CALLS=true            # Enable parallel tool execution
PARALLEL_TOOL_CONCURRENCY=3                # Default concurrency level
PARALLEL_TOOL_MAX_CONCURRENCY=5            # Maximum concurrency
```

### Optional - Browser/Playwright

```env
IS_ELECTRON=false                          # Running in Electron desktop app
PLAYWRIGHT_EXECUTABLE_PATH=                # Custom Playwright browser path
PUPPETEER_EXECUTABLE_PATH=                 # Legacy browser path (alternative)
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1         # Skip browser download in Docker
```

### Optional - Model Caching

```env
MODEL_CACHE_REFRESH_MS=3600000             # Background refresh interval (1 hour)
```

### Optional - Misc

```env
MESSAGE_EVENTS_ENABLED=true                # Enable message event streaming
SKIP_AUTO_START=false                      # Skip background task startup
UI_DIST_PATH=./public                      # Custom path for bundled UI
```

## Frontend (`frontend/.env.local`)

```env
NEXT_PUBLIC_API_BASE=/api                  # API base path (required)
BACKEND_ORIGIN=http://localhost:3001       # Backend server origin (required)
NEXT_PUBLIC_APP_NAME=ChatForge             # Application name (optional)
```

## Docker-specific

These variables are typically set in `docker-compose.yml` or `compose.dev.yml`:

```env
NODE_ENV=development                       # Environment mode (development|production)
CHOKIDAR_USEPOLLING=1                      # File watching in Docker
WATCHPACK_POLLING=true                     # Next.js file watching
```

## Production Notes

- **Never commit `.env` files to version control**
- Store `.env` files securely and only share with authorized team members
- Use strong, randomly generated values for `JWT_SECRET`
- Rotate API keys periodically
- Use environment-specific configuration for different deployment stages
