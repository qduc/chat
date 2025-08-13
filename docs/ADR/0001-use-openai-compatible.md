# ADR 0001: Use OpenAI-compatible API
- Date: 2025-08-13
- Status: Accepted
- Context: Max portability across providers (OpenAI, OpenRouter, vLLM).
- Decision: Conform to `/v1/chat/completions` schema for requests/responses.
- Consequences: Easy provider switching; must handle minor schema quirks.
