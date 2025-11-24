# Environment Variables Reference

## Backend (`backend/.env`)

### Required

```env
OPENAI_API_KEY=your-api-key-here          # OpenAI API key (or use PROVIDER_API_KEY)
JWT_SECRET=your-secret-key-here           # Secret for JWT authentication (required)
```

### Optional - Core Settings

```env
DEFAULT_MODEL=gpt-4o-mini                 # Default AI model
DEFAULT_TITLE_MODEL=gpt-4o-mini           # Model for conversation titles
PORT=3001                                  # Server port
RATE_LIMIT_WINDOW=60                       # Rate limit window in seconds
RATE_LIMIT_MAX=50                          # Max requests per window
CORS_ORIGIN=http://localhost:3000         # CORS allowed origin
```

### Optional - Provider Configuration

```env
PROVIDER=openai                            # Provider selection (openai, anthropic, gemini)
PROVIDER_BASE_URL=                         # Custom provider base URL
PROVIDER_API_KEY=                          # Generic provider API key
PROVIDER_CUSTOM_HEADERS={}                 # Custom headers as JSON
OPENAI_BASE_URL=https://api.openai.com/v1 # OpenAI base URL
ANTHROPIC_BASE_URL=https://api.anthropic.com # Anthropic base URL
ANTHROPIC_API_KEY=                         # Anthropic API key (if different from PROVIDER_API_KEY)
```

### Optional - Tool Configuration

```env
TAVILY_API_KEY=your-tavily-key            # Tavily web search (optional)
EXA_API_KEY=your-exa-key                  # Exa web search (optional)
SEARXNG_BASE_URL=                         # SearXNG instance URL (optional)
```

### Optional - Timeouts

```env
PROVIDER_TIMEOUT=10000                     # Provider operation timeout (ms)
MODEL_TIMEOUT=3000                         # Model fetching timeout (ms)
STREAMING_TIMEOUT=300000                   # Streaming timeout (ms)
```

### Optional - Logging

```env
LOG_LEVEL=info                             # Log level (trace/debug/info/warn/error/fatal)
PRETTY_LOGS=true                           # Human-friendly logs (dev only)
MAX_LOG_RETENTION_DAYS=3                   # Log retention days
```

### Optional - Persistence

```env
ENABLE_PERSISTENCE=true                    # Enable conversation persistence
DATABASE_URL=                              # Database URL (defaults to SQLite)
RETENTION_DAYS=30                          # Days to retain conversations
MAX_CONVERSATIONS_PER_SESSION=100          # Conversation limit per session
MAX_MESSAGES_PER_CONVERSATION=1000         # Message limit per conversation
BATCH_FLUSH_INTERVAL=250                   # Batch flush interval (ms)
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

## Frontend (`frontend/.env.local`)

```env
NEXT_PUBLIC_API_BASE=/api                  # API base path (required)
BACKEND_ORIGIN=http://localhost:3001       # Backend server origin (required)
NEXT_PUBLIC_APP_NAME=ChatForge             # Application name (optional)
```

## Production Notes

- **Never commit `.env` files to version control**
- Store `.env` files securely and only share with authorized team members
- Use strong, randomly generated values for `JWT_SECRET`
- Rotate API keys periodically
- Use environment-specific configuration for different deployment stages
