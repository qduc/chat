# Tech Stack

## Frontend
- **Next.js 15** (App Router) with Turbopack for development
- **React 19** with modern features
- **TypeScript 5.9** for type safety
- **Tailwind CSS 4** for styling
- **State Management**: Local React state (TanStack Query not yet added)
- **Markdown**: `react-markdown` with `rehype-highlight` for syntax highlighting
- **Streaming**: `fetch` + ReadableStream manual SSE parsing (in `frontend/lib/chat.ts`)
- **Testing**: Jest + Testing Library with jsdom environment

## Backend
- **Node.js 20** + **Express 5** (ES Modules)
- **Database**: SQLite with `better-sqlite3` (Postgres planned)
- **UUID Generation**: `uuid` for session/conversation IDs
- **HTTP Client**: `node-fetch` for upstream API calls
- **Logging**: `morgan` (structured logging with pino planned)
- **CORS**: `cors` middleware for cross-origin requests
- **Rate Limiting**: In-memory per-IP (Redis planned for production)
- **Testing**: Jest with ES modules support
- **Code Quality**: ESLint + Prettier

## APIs & Protocols
- **OpenAI-Compatible**: Full compatibility with OpenAI Chat Completions API
- **Responses API**: Extended support with conversation continuity
- **SSE Streaming**: Server-Sent Events for real-time chat responses
- **Auth**: None currently (JWT/API key authentication planned)

## Infrastructure & Deployment

### Containerization
- **Docker**: Multi-stage builds for optimized images
- **Development**: `docker-compose.dev.yml` with hot reload and dev dependencies
- **Production**: `docker-compose.yml` with minimal production images
- **Backend Image**: Node 20 Alpine with production dependencies only
- **Frontend Image**: Multi-stage build with configurable `NEXT_PUBLIC_API_BASE`

### Environment Configuration
- **Secrets Management**: Environment files (`.env`) - never baked into images
- **Development**: Local `.env` files with examples provided
- **Production**: External secret management (planned)

## LLM Provider Integration

### OpenAI Compatibility
- **Base URL**: Configurable `OPENAI_BASE_URL` (defaults to `https://api.openai.com/v1`)
- **Default Model**: `gpt-4.1-mini` (configurable via `DEFAULT_MODEL`)
- **API Key**: Server-side injection of `Authorization` header
- **Provider Flexibility**: Any OpenAI-compatible endpoint supported

### Benefits
- **Standard Payloads**: Consistent request/response formats
- **Vendor Flexibility**: Easy provider switching
- **Minimal Lock-in**: Standard OpenAI schema reduces dependencies
