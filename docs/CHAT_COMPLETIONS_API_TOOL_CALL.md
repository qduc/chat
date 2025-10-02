# 🧰 Chat Completions + Tool Calling — `curl` Cheatsheet

## 0) Endpoint & headers

```bash
# .env: export OPENAI_API_KEY=...
BASE=https://api.openai.com/v1

# Common headers
-H "Content-Type: application/json" \
-H "Authorization: Bearer $OPENAI_API_KEY"
```

Docs: Chat Completions API reference. ([OpenAI Platform][1])

---

## 1) First request: define your tool(s) and ask

```bash
curl -s $BASE/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is the weather in Paris right now?"}
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "Get the current weather for a city",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {"type": "string", "description": "City, Country"}
            },
            "required": ["location"]
          }
        }
      }
    ]
  }'
```

**You’ll get back an assistant message** with a `tool_calls` array when the model decides to call your function, e.g.:

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "tool_calls": [
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "get_weather",
              "arguments": "{\"location\":\"Paris, France\"}"
            }
          }
        ]
      }
    }
  ]
}
```

Docs & flow: Function/Tool calling guide; Chat Completions reference. ([OpenAI Platform][2])

---

## 2) Run your tool (outside OpenAI)

You execute `get_weather(location="Paris, France")` with your own code/API and prepare a JSON result:

```json
{ "temperature": "18°C", "condition": "Cloudy" }
```

(When function calling is used, **JSON mode is effectively enforced for arguments**, which keeps things tidy. 😉) ([OpenAI Help Center][3])

---

## 3) Respond with a `role:"tool"` message (continuation request)

> In Chat Completions, you **continue the same conversation** by appending two messages: the prior assistant message (with `tool_calls`) and **your tool result** as a `role:"tool"` message that references the **same `tool_call_id`**.

```bash
# Suppose you saved the previous assistant message and IDs.
# CALL_ID=call_abc123

TOOL_OUT='{"temperature":"18°C","condition":"Cloudy"}'

curl -s $BASE/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d "{
    \"model\": \"gpt-4o-mini\",
    \"messages\": [
      {\"role\": \"system\", \"content\": \"You are a helpful assistant.\"},

      {\"role\": \"user\", \"content\": \"What is the weather in Paris right now?\"},

      {\"role\": \"assistant\",
       \"tool_calls\": [{
         \"id\": \"call_abc123\",
         \"type\": \"function\",
         \"function\": {\"name\": \"get_weather\", \"arguments\": \"{\\\"location\\\":\\\"Paris, France\\\"}\"}
       }]
      },

      {\"role\": \"tool\",
       \"tool_call_id\": \"call_abc123\",
       \"content\": $(printf %s "$TOOL_OUT" | jq -Rsa .)
      }
    ]
  }"
```

**Why this shape?** Chat Completions is stateless between calls—you must resend enough **message history** so the model sees the tool call and your reply. Also, **`role:"tool"` must directly reply to a preceding `tool_calls`** (or you’ll get errors). ([OpenAI Platform][1])

---

## 4) Model finalizes the answer

The next assistant message will usually produce the natural-language answer (e.g., “It’s 18°C and cloudy in Paris.”). If it needs *more* tools, it may emit more `tool_calls`—just repeat step 2–3. Flow guidance: ([OpenAI Platform][2])

---

## 🎛 Forcing tool usage (or a specific tool)

You can **force** the model to call one of your tools with `tool_choice`, or force a **specific tool**:

```json
"tool_choice": "required"
```

or:

```json
"tool_choice": {"type":"function","function":{"name":"get_weather"}}
```

Feature note: forcing function calls in Chat Completions. ([OpenAI Community][4])

---

## 📦 Multiple tool calls in one turn

If the model returns **multiple** tool calls, run each and then append **one `role:"tool"` message per call**, each with its own `tool_call_id`, before asking the model again. (Same message-history pattern.) Best practices reflected across guides & forum examples. ([OpenAI Platform][2])

---

## 🧩 Structured outputs (optional)

If you want the **final** model message in a strict JSON shape, use `response_format: {"type":"json_object"}`; note that **tool arguments already use JSON** thanks to function calling. ([OpenAI Platform][5])

---

## 🌊 Streaming (quick note)

Enable `"stream": true` to receive incremental deltas over SSE. The tool-call object still appears in the streamed assistant message; you’ll detect it and pause to run your tool, then resume with the `role:"tool"` message pattern. (See streaming in Chat Completions reference.) ([OpenAI Platform][1])

---

## 🧯 Common gotchas

* **Missing `tool_call_id`** on your `role:"tool"` message → must match the assistant’s `tool_calls[i].id`. ([OpenAI Community][6])
* **Forgetting to include the prior assistant message** (with the `tool_calls`) when continuing → the API can’t link your tool result to anything. ([OpenAI Platform][1])
* **Bad JSON escaping** in `curl -d` → wrap payload pieces using `jq -Rsa` (as shown) to keep quotes safe.
* **Parameter schema mismatches** → remember tools use **JSON Schema** for `parameters`. ([OpenAI Platform][2])