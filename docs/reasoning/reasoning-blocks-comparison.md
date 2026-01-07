# Reasoning Blocks vs. OpenRouter Guidance

## Source Reference
- Guide: OpenRouter, "Reasoning Tokens – Preserving reasoning blocks" (retrieved October 5, 2025).

## Expectations from OpenRouter
1. `reasoning_details` array must be preserved exactly as returned.
2. Streaming responses emit reasoning chunks in `choices[].delta.reasoning_details`.
3. Non-streaming responses carry reasoning in `choices[].message.reasoning_details`.
4. Follow-up requests should resend the original reasoning blocks when continuing conversations, especially around tool calls, without reordering or altering the sequence.
5. Reasoning controls use unified `reasoning` payload (superseding legacy flags), while `reasoning_tokens` should be tracked for usage reporting.

## ChatForge Implementation Status (January 2026)

### Resolved Gaps
- **Propagate `reasoning_details` End-to-End**: ✅ **Resolved**. Adapters and streaming handlers now include reasoning arrays alongside message content. The frontend correctly handles `delta.reasoning_content` and displays `<thinking>` segments.
- **Persist Structured Reasoning**: ✅ **Resolved**. The persistence layer (hybrid checkpoint persistence) now captures and stores structured reasoning content, ensuring it is preserved across sessions and turns.
- **Replay Reasoning Blocks in Requests**: ✅ **Resolved**. When building conversation history for models that support it (like OpenRouter), the preserved `reasoning_details` are attached to maintain reasoning continuity, especially during multi-turn tool orchestration.
- **Audit Usage Reporting**: ✅ **Resolved**. `reasoning_tokens` and `reasoning_token_count` are now tracked and surfaced in API responses and UI for better cost visibility.

### Current Implementation Snapshot

- **Reasoning Controls**: `reasoning_effort` and `reasoning_format` are fully supported and mapped to provider-specific payloads.
- **Streaming Preservation**: Reasoning content is streamed separately and accumulated correctly during tool iterations.
- **Tool Orchestration Continuity**: `reasoning_details` are preserved across tool call iterations to ensure the model doesn't lose its "train of thought" when executing tools.

## Summary
The recommendations from October 2025 have been fully implemented. ChatForge now provides robust support for structured reasoning blocks, maintaining parity with OpenRouter's guidance and enhancing the user experience for reasoning-heavy models.

