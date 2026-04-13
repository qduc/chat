# Streaming response normalization to `message_events`

## Context
The frontend currently consumes streaming assistant responses by assembling raw text into `content` and storing tool interactions separately in `tool_calls` / `tool_outputs`.

Historical conversations returned from the backend already use a stable event-based format under `message_events`, which defines ordered boundaries between content, reasoning, and tool events.

## What
Normalize live streamed assistant responses into the same structured `message_events` format used by backend-loaded conversations.

This means the frontend should represent streamed segments as ordered events rather than relying primarily on raw content with inserted markers like `<thinking>...</thinking>`.

## Why
- Provides a consistent representation for both live-streamed and historical conversation messages.
- Makes boundaries explicit for reasoning, tool calls, and normal text.
- Reduces dependence on marker-based parsing inside `content`.
- Simplifies rendering and future handling by aligning live stream state with backend conversation data.

## Current Technical Gap
Investigation of the current implementation reveals a critical logic divergence:

1.  **Backend Capability:** The backend already supports a structured `message_events` table ([backend/src/db/messageEvents.js](backend/src/db/messageEvents.js)) and a normalization layer in `SimplifiedPersistence` ([backend/src/lib/simplifiedPersistence.js](backend/src/lib/simplifiedPersistence.js)).
2.  **Frontend Live-Stream Hack:** The current `handleStreamingResponse` ([frontend/lib/api/streaming-handler.ts](frontend/lib/api/streaming-handler.ts#L481)) manually injects `<thinking>` and `</thinking>` tags into a single raw `content` string.
3.  **Frontend Historical Consistency:** In contrast, messages loaded from the database arrive as a set of discrete, ordered events.

## Risks of Status Quo
- **Brittle Parsing:** The frontend relies on "magic strings" like `<thinking>` to segment reasoning. Real model output containing these strings will cause catastrophic UI layout failures.
- **Lost Sequencing:** If a model interleaves text and tool calls (e.g., "Step 1", [Tool], "Step 2"), the current frontend flattens these into separate arrays (`content` vs `tool_calls`), losing the model's intended logical flow during live streaming.
- **State Flicker:** A message has one "shape" while typing and another "shape" after a page refresh. This inconsistency makes debugging and maintenance twice as hard.

## Recommendation
Approve this refactor to unify the "In-Flight" and "Persisted" message data models. By treating live streams as a sequence of `message_events` from the first token, we eliminate parsing hacks and ensure the UI always reflects precisely what the model intended, regardless of whether it's a live response or a historical record.
