# Multi-Provider Chat Architecture

This document explains the backend abstractions that enable ChatForge to speak to multiple upstream model providers (OpenAI, Anthropic, Gemini, etc.). It focuses on the provider adapter layer, the proxy entrypoint, and the orchestration flows so that new contributors know where to extend the system.

## Goals

- Support vendor-specific request/response shapes without rewriting the whole proxy.
- Make it easy to add new providers by implementing a small adapter surface.
- Preserve existing features (streaming, tool orchestration, persistence) regardless of provider.

## Key Concepts

### Internal Request Format

The application exposes a provider-agnostic chat payload to the rest of the backend (sanitized user messages, optional tool names, reasoning controls, etc.). Providers translate this internal format to their upstream API.

### Provider Adapter

Adapters live under `backend/src/lib/providers/`:

- `baseProvider.js` defines the minimal interface (`normalizeRequest`, `sendRequest`, `normalizeResponse`, `normalizeStreamChunk`, capability flags).
- `openaiProvider.js`, `anthropicProvider.js`, `geminiProvider.js` extend this base class with vendor-specific logic.

**Responsibilities:**

- Translate internal request → upstream payload.
- Translate upstream responses/chunks → internal format for orchestration/persistence.
- Advertise capabilities (`supportsTools`, `supportsReasoningControls`, tool schema, default model).
- Own HTTP interaction (`sendRequest`).

### Provider Registry

`backend/src/lib/providers/index.js` resolves provider settings (from DB `providers` table or env) and instantiates the appropriate adapter. It exposes helpers used across the codebase:

- `createProvider(config, { providerId, http })`
- `providerIsConfigured`
- `providerSupportsReasoning`
- `getDefaultModel`
- `providerChatCompletions`

When adding a new provider, register it in `providerConstructors` and ensure `resolveProviderSettings` can fetch required credentials.

### Proxy Entry Point

`backend/src/lib/openaiProxy.js` acts as the gateway for `/v1/chat/completions`:

1. Instantiate the provider via `createProvider`.
2. Sanitize the incoming body (map system prompts, expand tool names using provider-provided tool specs).
3. Validate reasoning parameters based on provider capabilities.
4. Choose an orchestration strategy (plain vs. tool, streaming vs. JSON) and pass the provider instance downstream.

The legacy `createOpenAIRequest` helper now delegates to `providerChatCompletions`, so new providers plug in without changing the proxy.

### Orchestration Flows

Both orchestrators consume the provider interface:

- `handleIterativeOrchestration` (streaming tool loop) obtains tool schemas and capability flags from the provider.
- `handleUnifiedToolOrchestration` (multi-step tool execution) uses the same provider data for non-streaming and streaming flows.

They continue to use internal tool handlers (`backend/src/lib/tools.js`), so only provider adapters care about wire formats.

### Persistence Integration

`SimplifiedPersistence` now checks `providerIsConfigured` asynchronously before attempting title generation, enabling DB-backed provider defaults.

## Adding a New Provider

1. **Create Adapter**: Copy `openaiProvider.js` into a new file and implement all TODO methods.
2. **Registry Update**: Register the provider key in `providerConstructors` and ensure `resolveProviderSettings` can pull base URL/API key (possibly extend the `providers` table metadata schema).
3. **Tool Schema**: Implement `getToolsetSpec` to translate internal tool definitions into the provider’s schema (return empty if unsupported).
4. **Streaming Support**: Implement `normalizeStreamChunk` so SSE parsing works with `handleRegularStreaming` and persistence.
5. **Tests**: Add adapter-specific tests (mock upstream responses) and regression tests covering request/response translation.

## Follow-Up TODOs

- Implement the Anthropic and Gemini skeletons.
- Wire `normalizeResponse`/`normalizeStreamChunk` into the streaming pipeline so downstream consumers receive consistent events.
- Extend tool generation (currently OpenAI-spec) to support providers with different function schemas.
- Add integration tests that exercise provider switching and fallback behaviour.

## Reference Files

- `backend/src/lib/providers/baseProvider.js`
- `backend/src/lib/providers/index.js`
- `backend/src/lib/openaiProxy.js`
- `backend/src/lib/iterativeOrchestrator.js`
- `backend/src/lib/unifiedToolOrchestrator.js`
- `backend/src/lib/simplifiedPersistence.js`

Keep this doc updated as adapters are implemented.
