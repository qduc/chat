<!--
Sync Impact Report:
Version change: 1.0.0 → 1.1.0
Modified / Added principles:
- Added VI. State Management Single Source of Truth
Added sections: None
Removed sections: None
Templates requiring updates:
✅ Updated: .specify/templates/plan-template.md (added Constitution Check item for state management)
✅ Updated: specs/001-i-want-the/plan.md (version footer + new Constitution Check item optional for future regen)
⚠ Pending: Existing feature plans other than 001 (regenerate or manually edit if any) to include new check
Follow-up TODOs: None
-->

# ChatForge Constitution

## Core Principles

### I. Service Boundary Isolation
Frontend (Next.js) and Backend (Express) must maintain clear separation of concerns. Frontend handles UI state and user interactions only; Backend handles business logic, API proxying, tool orchestration, and data persistence. Cross-service communication occurs exclusively via HTTP/SSE APIs with no shared modules or direct database access from frontend.

**Rationale**: Prevents tight coupling, enables independent scaling, and maintains clear debugging boundaries in a full-stack application.

### II. OpenAI API Compatibility
All chat endpoints must maintain strict OpenAI Chat Completions API compatibility for request/response formats. Extensions (tool orchestration, research mode, conversation persistence) must be implemented as optional parameters or separate endpoints without breaking core OpenAI contract.

**Rationale**: Ensures drop-in compatibility with existing OpenAI integrations and allows seamless provider switching.

### III. Test-First Development (NON-NEGOTIABLE)
Every feature must follow TDD: Write tests → Get approval → Watch tests fail → Implement → Green → Refactor. Both unit tests (Jest) and integration tests are required for backend services. Frontend components require Jest + Testing Library coverage.

**Rationale**: Prevents regressions in a streaming/async system where bugs are hard to reproduce and ensures reliable tool orchestration behavior.

### IV. Server-Side Tool Execution
All tool calling and orchestration must execute server-side only. Tools must never be exposed to or executed by the frontend. Input validation using Zod schemas is mandatory before tool execution. Tool outputs must be sanitized before client transmission.

**Rationale**: Prevents code injection attacks, secures API keys, and enables proper timeout/error handling for long-running tools.

### V. Docker-First Development
All development must occur within Docker containers using docker-compose.dev.yml. The ./dev.sh script must be used for all commands (test, lint, migrate). Local Node.js development outside containers is not supported.

**Rationale**: Ensures consistent development environment, eliminates "works on my machine" issues, and matches production containerized deployment.

### VI. State Management Single Source of Truth
The chat frontend MUST treat `useChatState` as the sole authority for conversation metadata, message history, prompt selections, and dispatchable actions. UI components (e.g., ChatV2, RightSidebar, MessageList, MessageInput) MUST remain passive presenters: they read derived state and invoke provided actions; they MUST NOT mutate state, duplicate conversation caches, or perform direct network calls that bypass `useChatState`.

All outbound chat-related API interactions (sending messages, selecting/clearing prompts, fetching conversations) MUST originate inside `useChatState` actions to guarantee reducer-first updates and eliminate race conditions between optimistic UI and backend responses.

**Rationale**: Prevents divergent client state, reduces hard-to-reproduce streaming bugs, and centralizes invariants (ordering, dedupe, optimistic merges) in one reducer, improving testability and reliability of SSE/tool orchestration flows.

## Security Requirements

- API keys must never be exposed to frontend/browser
- Tool inputs must be validated with Zod schemas before execution
- Database conversations must be stored with proper indexing and retention policies
- Rate limiting must be enforced at IP level (in-memory acceptable for development)
- CORS origins must be explicitly configured (not wildcard in production)
- Structured logging must not leak sensitive data (API keys, user content)

## Development Workflow

- All features must be developed in Docker environment using ./dev.sh
- Database schema changes require migrations via ./dev.sh migrate
- Both frontend and backend must maintain separate test suites
- ESLint + Prettier must pass before commits
- SSE streaming must be tested with both success and error scenarios
- Tool orchestration changes must test iterative workflows and timeout handling

## Governance

This constitution supersedes all other development practices. Amendments require justification with architectural impact analysis and migration plan. All PRs must verify constitutional compliance, especially for service boundaries, API compatibility, and security requirements.

Use AI_ONBOARDING.md for runtime development guidance and architectural patterns.

**Version**: 1.1.0 | **Ratified**: 2025-09-26 | **Last Amended**: 2025-09-27