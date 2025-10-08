# 🔌 Pseudocode: Streaming Chat ⇄ Responses Adapter

## Public entry (non-stream vs stream)

```pseudo
function chatCompletionsAdapter(chatReq, onChunk=None):
    if chatReq.stream == true and onChunk != None:
        return chatCompletionsAdapterStream(chatReq, onChunk)
    else:
        // fallback to non-stream path from earlier
        return chatCompletionsAdapter(chatReq)  // the non-stream function you already have
```

---

## 1) Streamed adapter (Chat → Responses (SSE) → Chat deltas)

```pseudo
function chatCompletionsAdapterStream(chatReq, onChunk):
    // 1) Map Chat → Responses (same mapper you wrote before)
    respReq = toResponsesRequest(chatReq)
    respReq.stream = true  // IMPORTANT: ask Responses API for SSE

    // 2) Open SSE to Responses API
    sse = openSSE("https://api.openai.com/v1/responses", respReq, auth=chatReq.auth)

    // 3) State we need to mirror Chat's streaming format
    state = {
      sentRoleHeader: false,                 // Chat streams role once at start
      toolCalls: {},                         // map callId -> {name, argsBuffer, index, emittedHeader}
      toolCallOrder: [],                     // preserve order for indices
      chunkIndex: 0,                         // we expose single choice index 0
      finished: false,
      finishReason: null,
      usage: null                            // fill at end if Responses gives us usage
    }

    // 4) Emit initial assistant role (Chat style) lazily when first content or tool delta arrives
    function ensureRoleHeader():
        if not state.sentRoleHeader:
            onChunk(chatDeltaChunk(role="assistant"))
            state.sentRoleHeader = true

    // 5) Main loop: translate Responses SSE events → Chat deltas
    for event in sse:
        switch event.type:

            case "response.output_text.delta":
                // Plain text tokens from the model
                ensureRoleHeader()
                onChunk(chatDeltaChunk(contentDelta=event.delta))

            case "response.refusal.delta":
                // If model emits a refusal stream, treat as content (or map to your policy)
                ensureRoleHeader()
                onChunk(chatDeltaChunk(contentDelta=event.delta))

            case "response.tool_call.created":
                // New tool call announced
                ensureRoleHeader()
                callId = event.id
                pushToolCallHeaderIfNeeded(state, callId, name=null, onChunk)

            case "response.tool_call.delta":
                // Tool call partials: may include function name and/or arguments fragments
                ensureRoleHeader()
                callId = event.id
                ensureToolCallSlot(state, callId)

                if event.name_delta exists and not state.toolCalls[callId].emittedHeader:
                    // In Chat streaming, when tool call begins we emit the scaffold with name (if known)
                    pushToolCallHeaderIfNeeded(state, callId, name=event.name_delta, onChunk)

                if event.arguments_delta exists:
                    // Append arguments string and stream it as delta
                    state.toolCalls[callId].argsBuffer += event.arguments_delta
                    onChunk(chatDeltaChunk(
                        toolCallIndex=state.toolCalls[callId].index,
                        toolCallArgumentsDelta=event.arguments_delta
                    ))

            case "response.tool_call.completed":
                // Nothing special to emit now; Chat format doesn’t require a separate close marker
                // (we already streamed the args text; completion is implicit)
                noop()

            case "response.completed":
                state.finished = true
                state.finishReason = mapFinishReason(event.finish_reason) // default "stop" if missing

            case "response.usage":
                state.usage = mapUsage(event.usage)  // {prompt_tokens, completion_tokens, total_tokens}

            case "response.error":
                // Surface as a Chat-style error termination, or raise
                state.finished = true
                state.finishReason = "error"
                onChunk(chatErrorChunk(event.error_message))

            default:
                // Ignore unrecognized event types for forward-compat
                noop()

    // 6) End of stream: emit final choice finish + optional usage
    if state.finished == false:
        state.finishReason = state.finishReason or "stop"

    onChunk(chatFinalChunk(finishReason=state.finishReason, usage=state.usage))

    // 7) The Chat protocol expects a terminator token (SSE “[DONE]”) in many clients
    onChunk(doneToken())
```

---

## 2) Helpers to produce **Chat-style** stream chunks

```pseudo
function chatDeltaChunk(role=None, contentDelta=None, toolCallIndex=None, toolCallArgumentsDelta=None):
    // Mirrors OpenAI Chat Completions streaming shape:
    // {
    //   "id": "...",
    //   "object": "chat.completion.chunk",
    //   "created": <ts>,
    //   "model": <model>,
    //   "choices": [{
    //       "index": 0,
    //       "delta": { "role"?: "assistant", "content"?: "…", "tool_calls"?: [ …partial… ] },
    //       "finish_reason": null
    //   }]
    // }

    delta = {}
    if role != None:
        delta.role = role

    if contentDelta != None:
        delta.content = contentDelta

    if toolCallIndex != None:
        // Partial tool_calls delta structure
        // NOTE: Chat’s streamed tool call arguments are appended as plain string deltas.
        delta.tool_calls = [{
            "index": toolCallIndex,
            "id": null,                              // optional; can be sent once you know it
            "type": "function",
            "function": {
                "name": null,                        // only when first known; else omit
                "arguments": toolCallArgumentsDelta  // this is a partial string append
            }
        }]

    return {
        "id": generateId("chatcmpl-chunk"),
        "object": "chat.completion.chunk",
        "created": epochSecondsNow(),
        "model": getModelEcho(), // echo from request
        "choices": [{
            "index": 0,
            "delta": delta,
            "finish_reason": null
        }]
    }

function chatErrorChunk(message):
    return {
      "id": generateId("chatcmpl-chunk"),
      "object": "chat.completion.chunk",
      "created": epochSecondsNow(),
      "model": getModelEcho(),
      "choices": [{
        "index": 0,
        "delta": {},
        "finish_reason": "error"
      }],
      "error": { "message": message }
    }

function chatFinalChunk(finishReason, usage=None):
    // Final chunk sets finish_reason; delta is empty
    base = {
      "id": generateId("chatcmpl-chunk"),
      "object": "chat.completion.chunk",
      "created": epochSecondsNow(),
      "model": getModelEcho(),
      "choices": [{
        "index": 0,
        "delta": {},
        "finish_reason": finishReason
      }]
    }
    if usage != None:
        base.usage = usage
    return base

function doneToken():
    // If your client follows OpenAI’s “[DONE]” sentinel, send that as a plain SSE data line
    return "[DONE]"
```

---

## 3) Tool-call scaffolding (Chat-compatible)

```pseudo
function ensureToolCallSlot(state, callId):
    if not (callId in state.toolCalls):
        idx = state.toolCallOrder.length
        state.toolCalls[callId] = { index: idx, name: null, argsBuffer: "", emittedHeader: false }
        state.toolCallOrder.push(callId)

function pushToolCallHeaderIfNeeded(state, callId, name, onChunk):
    ensureToolCallSlot(state, callId)
    t = state.toolCalls[callId]
    if name != null:
        t.name = name
    if t.emittedHeader == false:
        // Emit a delta that starts the tool_calls array and includes the name (if known)
        onChunk({
          "id": generateId("chatcmpl-chunk"),
          "object": "chat.completion.chunk",
          "created": epochSecondsNow(),
          "model": getModelEcho(),
          "choices": [{
            "index": 0,
            "delta": {
              "tool_calls": [{
                "index": t.index,
                "id": null,                   // you may fill with callId if you prefer
                "type": "function",
                "function": {
                  "name": t.name,            // may be null if not known yet
                  "arguments": ""            // start with empty; future deltas append
                }
              }]
            },
            "finish_reason": null
          }]
        })
        t.emittedHeader = true
```

---

## 4) Mapping snippets (unchanged but used above)

```pseudo
function mapFinishReason(respFinish):
    // Map Responses finish reason → Chat’s set ("stop", "length", "tool_calls", "content_filter", "error")
    if respFinish == "tool_calls": return "tool_calls"
    if respFinish == "length": return "length"
    if respFinish == "stop" or not respFinish: return "stop"
    return "stop"

function mapUsage(respUsage):
    if not respUsage: return null
    return {
      "prompt_tokens": respUsage.input_tokens,
      "completion_tokens": respUsage.output_tokens,
      "total_tokens": respUsage.total_tokens
    }
```

---

## 5) Notes that save headaches

* **Emit the assistant role once** at the start of streaming output (Chat convention).
* **Tool call streaming:** keep an **ordered list**; each call gets a stable `index`. Append **argument deltas** as plain strings, exactly like Chat’s function-calling deltas.
* **Name timing:** sometimes the tool function **name** appears before arguments; sometimes only arguments stream at first—handle both.
* **Finish reasoning:** set `finish_reason: "tool_calls"` if the Responses stream indicates a tool request end state; otherwise default to `"stop"` unless you see `"length"` or an error.
* **Usage tokens:** some servers emit `usage` as a dedicated SSE event or at end—forward if present.
* **[DONE] sentinel:** if your client expects it, emit after the final chunk.
