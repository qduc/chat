# Reasoning Blocks vs. OpenRouter Guidance

## Source Reference
- Guide: OpenRouter, "Reasoning Tokens – Preserving reasoning blocks" (retrieved October 5, 2025).

## Expectations from OpenRouter
1. `reasoning_details` array must be preserved exactly as returned.
2. Streaming responses emit reasoning chunks in `choices[].delta.reasoning_details`.
3. Non-streaming responses carry reasoning in `choices[].message.reasoning_details`.
4. Follow-up requests should resend the original reasoning blocks when continuing conversations, especially around tool calls, without reordering or altering the sequence.
5. Reasoning controls use unified `reasoning` payload (superseding legacy flags), while `reasoning_tokens` should be tracked for usage reporting.

## ChatForge Implementation Snapshot (October 5, 2025)

### Strengths
- **Reasoning Controls Forwarded**: `responsesApiAdapter` maps `reasoning_effort` to the upstream `reasoning` object, and `openaiProxy` validates allowed values (`minimal`, `low`, `medium`, `high`).
- **Frontend Reasoning Stream Handling**: `frontend/lib/chat/client.ts` detects `delta.reasoning_content` and emits `<thinking>` segments so UI can distinguish reasoning text in-flight.

### Gaps vs. Guide
- **Reasoning Details Dropped**: `toChatCompletionResponse` flattens responses to plain `content`, so `reasoning_details` never reach clients. Streaming transformer also ignores `response.reasoning.*` deltas.
- **Persistence Omits Structured Reasoning**: Conversation manager only stores concatenated strings; the exact `reasoning_details` array is lost, preventing faithful replay in later calls.
- **History Replay Lacks Reasoning Blocks**: When rebuilding conversation history before sending to OpenRouter, only message text is reconstructed, violating the requirement to resend full reasoning sequences during tool workflows.
- **UI Displays Tags Instead of Structured Blocks**: Current approach wraps reasoning in `<thinking>` tags rather than surfacing the raw detail objects, which diverges from OpenRouter’s schema and risks incompatibility if formats evolve.

## Recommended Follow-ups
1. **Propagate `reasoning_details` End-to-End**: Extend adapters and streaming handlers to include reasoning arrays alongside message content, and update frontend types to display them explicitly.
2. **Persist Structured Reasoning**: Adjust storage schema/serialization so each assistant turn retains its `reasoning_details` payload for future resend.
3. **Replay Reasoning Blocks in Requests**: When building message history for OpenRouter, attach the preserved reasoning segments to maintain continuity during tool calls.
4. **Audit Usage Reporting**: Ensure `reasoning_tokens` are surfaced to UI/analytics so reasoning effort costs are visible alongside prompt/completion counts.

