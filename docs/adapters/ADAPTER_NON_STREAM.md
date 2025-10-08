# 🧩 Pseudocode: Chat ⇄ Responses Adapter

```pseudo
// ============ Public entry ============
function chatCompletionsAdapter(chatReq):
    // 1) Map Chat → Responses
    respReq = toResponsesRequest(chatReq)

    // 2) Call Responses API (non-streaming here for simplicity)
    respRes = httpPOST("https://api.openai.com/v1/responses", respReq, auth=chatReq.auth)

    // 3) Map Responses → Chat
    chatRes = toChatCompletionsResponse(respRes, originalChatReq=chatReq)

    return chatRes
```

---

## 1) Chat → Responses (request mapping)

```pseudo
function toResponsesRequest(chatReq):
    // Base envelope
    out = {}
    out.model = mapModelName(chatReq.model)            // optional remap; otherwise pass through
    out.temperature = chatReq.temperature ?? default
    out.top_p       = chatReq.top_p ?? default
    out.seed        = chatReq.seed (optional)

    // max tokens naming differs
    if chatReq.max_tokens exists:
        out.max_output_tokens = chatReq.max_tokens

    // Response format
    // Chat supports {"type":"json_object"} or {"type":"json_schema", ...}.
    // Responses supports json_object and json_schema too (names may differ by SDK; pass through when possible).
    if chatReq.response_format exists:
        out.response_format = mapResponseFormat(chatReq.response_format)

    // Tools: Chat uses {type:"function", function:{name,parameters,...}}
    // Responses uses {type:"function", name, description?, parameters}
    if chatReq.tools exists:
        out.tools = []
        for tool in chatReq.tools:
            if tool.type == "function":
                out.tools.push({
                    "type": "function",
                    "name": tool.function.name,
                    "description": tool.function.description,
                    "parameters": tool.function.parameters
                })

    // Tool choice: Chat supports "none" | "auto" | {"type":"function","function":{"name":...}}
    // Responses supports "none" | "auto/required" | {"type":"function","name":...}
    if chatReq.tool_choice exists:
        out.tool_choice = mapToolChoice(chatReq.tool_choice)

    // Messages → Responses "input"
    // Chat messages: [{role:"system"|"user"|"assistant"|"tool", content:string|array, ...}]
    // Responses "input": array of message objects with content parts.
    // We'll normalize all text to a single "input_text" part, and tool results to "output_text".
    out.input = []
    for m in chatReq.messages:
        if m.role in ["system", "user", "assistant"]:
            out.input.push({
                "role": m.role,
                "content": [
                    { "type": "input_text", "text": stringifyMessageContent(m.content) }
                ]
            })
            // Chat assistant message might contain prior tool_calls. We DO NOT
            // re-encode those as calls; keep them as plain text context if needed.
            // Tool state will be produced by the model in this new Responses call.
        else if m.role == "tool":
            // Chat uses: {"role":"tool","tool_call_id":"...","content": "...json..."}
            out.input.push({
                "role": "tool",
                "tool_call_id": m.tool_call_id,
                "content": [
                    { "type": "output_text", "text": stringifyMessageContent(m.content) }
                ]
            })
        else:
            // Unknown roles: ignore or map to user
            out.input.push({
                "role": "user",
                "content": [{ "type": "input_text", "text": stringifyMessageContent(m.content) }]
            })

    // System prompt convenience:
    // If multiple system messages exist, we just pass them in order as above.

    return out
```

**Notes**

* `stringifyMessageContent()` should join array parts (if any) into a single string.
* We don’t attempt to pre-create tool calls; the **Responses** model decides that.

---

## 2) Responses call

*(Simple HTTP; omitted actual HTTP code)*

```pseudo
function httpPOST(url, jsonBody, auth):
    // Set headers: Content-Type: application/json, Authorization: Bearer <key>
    // Return parsed JSON
```

---

## 3) Responses → Chat (response mapping)

```pseudo
function toChatCompletionsResponse(respRes, originalChatReq):
    // Chat response envelope
    chatRes = {
        "id": respRes.id or generateId("chatcmpl"),
        "object": "chat.completion",
        "created": epochSecondsNow(),
        "model": originalChatReq.model,      // echo original requested model
        "choices": [],
        "usage": mapUsage(respRes.usage)     // if available; else compute/omit
    }

    // Extract assistant text
    // Responses can return:
    //   - output_text (string)
    //   - content parts (e.g., {"type":"output_text","text":"..."})
    //   - tool_calls array (if model is asking to call tools)
    assistantText = extractOutputText(respRes)      // join all top-level output_text/content parts
    toolCalls = mapResponsesToolCalls(respRes)      // → Chat tool_calls format

    // Build a single choice (non-streaming)
    choice = {
        "index": 0,
        "finish_reason": inferFinishReason(toolCalls, assistantText, respRes),
        "message": {
            "role": "assistant",
            "content": assistantText,
            // Only include tool_calls if the model requested any
            // Chat format:
            // tool_calls: [{id, type:"function", function:{name, arguments:string}}]
            // arguments MUST be a stringified JSON.
            ...(toolCalls is empty ? {} : { "tool_calls": toolCalls })
        }
    }

    chatRes.choices.push(choice)
    return chatRes
```

### Helpers

```pseudo
function extractOutputText(respRes):
    // Priority 1: respRes.output_text if present
    if respRes.output_text exists:
        return respRes.output_text

    // Priority 2: concatenate any content parts that are textual
    if respRes.content exists:
        texts = []
        for part in respRes.content:
            if part.type in ["output_text", "text", "message"]:   // be tolerant
                texts.push(part.text)
        return texts.join("")

    // Fallback
    return ""

function mapResponsesToolCalls(respRes):
    out = []
    if respRes.tool_calls exists:
        for tc in respRes.tool_calls:
            if tc.type == "function":
                out.push({
                    "id": tc.id or generateId("call"),
                    "type": "function",
                    "function": {
                        "name": tc.name,
                        "arguments": ensureJSONString(tc.arguments) // Chat needs a string
                    }
                })
    return out

function inferFinishReason(toolCalls, text, respRes):
    if not empty(toolCalls):
        return "tool_calls"
    // If Responses exposes a finish_reason, map it; else default to "stop"
    if respRes.finish_reason exists:
        return mapFinishReason(respRes.finish_reason)
    return "stop"
```

---

## 🎛 Mapping utilities

```pseudo
function mapModelName(model):
    // Optionally rewrite aliases, else return as-is
    return model

function mapResponseFormat(chatRF):
    // Chat: {"type":"json_object"} or {"type":"json_schema", "json_schema":{...}}
    // Responses: supports "json_object" or "json_schema" (schema payload may differ slightly by SDK).
    // For pseudocode, pass through unchanged.
    return chatRF

function mapToolChoice(tc):
    // Chat:
    //   "none" | "auto" | {"type":"function","function":{"name":"..."}}
    // Responses:
    //   "none" | "auto" (or "required" in some SDKs) | {"type":"function","name":"..."}
    if tc == "none": return "none"
    if tc == "auto": return "auto"
    if tc.type == "function" and tc.function.name exists:
        return {"type":"function","name": tc.function.name}
    // Unknown → omit
    return null

function mapUsage(respUsage):
    if not respUsage: return null
    // Map field names if they differ; else pass as-is
    return {
        "prompt_tokens": respUsage.input_tokens,
        "completion_tokens": respUsage.output_tokens,
        "total_tokens": respUsage.total_tokens
    }
```

---

## 🧪 Edge cases & notes (read me!)

* **Tool history in Chat messages**: if the incoming Chat request includes prior `role:"tool"` messages, we map each to a Responses `role:"tool"` + `tool_call_id` + `output_text`. That lets the model see prior tool results.
* **Assistant messages with prior `tool_calls`**: we don’t try to re-encode those “calls” themselves; they’re model decisions from a previous turn. Keep the assistant text; the new Responses call can decide fresh tool calls.
* **Arguments must be strings in Chat**: always `JSON.stringify` the `arguments` when mapping Responses → Chat.
* **Finish reasons**: if Responses exposes something different, map to Chat’s `stop`, `length`, `tool_calls`, etc.
* **Streaming**: for SSE, adapt chunk-by-chunk; the same mapping logic applies per delta (out of scope here).
* **Max tokens**: Chat’s `max_tokens` → Responses `max_output_tokens`.
* **System prompts**: both APIs support them; we pass each system message through in order at the top of `input`.
