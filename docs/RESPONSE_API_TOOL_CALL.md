# 🧰 Tool-Calling with the Responses API — `curl` Cheatsheet

## 0) Endpoint & headers

```bash
# .env: export OPENAI_API_KEY=...
BASE=https://api.openai.com/v1

# Common headers
-H "Content-Type: application/json" \
-H "Authorization: Bearer $OPENAI_API_KEY"
```

Refs: Responses API overview & reference. ([OpenAI Platform][1])

---

## 1) Define your tool(s) and send the first request

```bash
curl -s $BASE/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-5.0",
    "input": "What is the weather in Paris right now?",
    "tools": [
      {
        "type": "function",
        "name": "get_weather",
        "description": "Get the current weather for a city",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "City and country, e.g. Paris, France"
            }
          },
          "required": ["location"]
        }
      }
    ]
  }'
```

**What you’ll get back (key bits):**

* A **response `id`** (save this—used as `previous_response_id` next step).
* An array of **`tool_calls`** (the model asks you to run `get_weather` with parsed `arguments`).
  Docs: “Using tools” + Responses API reference. ([OpenAI Platform][2])

---

## 2) Run your tool yourself (outside OpenAI)

Example output from your system (you format it as JSON):

```json
{ "temperature": "18°C", "condition": "Cloudy" }
```

Now we feed this **tool result** back to the model so it can finish the answer.

---

## 3) Return tool result with `previous_response_id`

> The Responses API is **stateful**. To continue the same turn, send a new request with:
>
> * the **`previous_response_id`** from step 1
> * a **message** of `role: "tool"` that matches the **`tool_call_id`** you received

```bash
curl -s $BASE/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-5.0",
    "previous_response_id": "resp_xxx_from_step_1",
    "input": [
      {
        "role": "tool",
        "tool_call_id": "call_abc123",   // from step 1 response
        "content": [
          { "type": "output_text", "text": "{\"temperature\":\"18°C\",\"condition\":\"Cloudy\"}" }
        ]
      }
    ]
  }'
```

**Notes that matter:**

* `role` **must** be `"tool"` and **must** include a matching `tool_call_id`, or you’ll get errors like “Missing parameter 'tool_call_id'” or “No tool call found…”. ([Microsoft Learn][3])
* `previous_response_id` stitches the turn; Responses API manages the thread for you. ([OpenAI Platform][4])
* Content is a list of parts; `output_text` is the simplest way to return your tool’s JSON result. (See Responses API content model.) ([OpenAI Platform][5])

---

## 4) Model finishes the answer

The second response will typically contain natural language like:

> “The weather in Paris is 18 °C and cloudy.”

(Plus any additional **tool calls** if it needs more work—Responses API supports agentic loops.) ([OpenAI Platform][4])

---

## Bonus: Minimal jq-driven end-to-end bash sketch

```bash
# 1) Ask + define tool
R1=$(curl -s $BASE/responses -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" -d '{
    "model":"gpt-5.0",
    "input":"What is the weather in Paris right now?",
    "tools":[{"type":"function","name":"get_weather","parameters":{"type":"object","properties":{"location":{"type":"string"}},"required":["location"]}}]
  }')

RID=$(echo "$R1" | jq -r '.id')
CALL_ID=$(echo "$R1" | jq -r '.tool_calls[0].id')
CITY=$(echo "$R1" | jq -r '.tool_calls[0].arguments.location')

# 2) Run your real tool (fake here)
WEATHER_JSON=$(jq -nc --arg t "18°C" --arg c "Cloudy" '{temperature:$t,condition:$c}')

# 3) Send tool result
R2=$(curl -s $BASE/responses -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" -d "{
    \"model\": \"gpt-5.0\",
    \"previous_response_id\": \"$RID\",
    \"input\": [{
      \"role\": \"tool\",
      \"tool_call_id\": \"$CALL_ID\",
      \"content\": [{\"type\":\"output_text\",\"text\": $(printf %s "$WEATHER_JSON" | jq -Rsa .) }]
    }]
  }")

echo "$R2" | jq -r '.output_text'
```

Docs covering statefulness & tools: ([OpenAI Platform][5])

---

## Common gotchas (and fixes)

* **Forgetting `tool_call_id`** on the tool message → add it, matching the assistant’s `tool_calls[0].id`. ([Microsoft Learn][3])
* **Wrong continuation** (model “forgets” context) → ensure **`previous_response_id`** is set to the last response’s `id`. ([OpenAI Platform][4])
* **Bad JSON escaping** inside `curl -d` → wrap JSON result with `jq -Rsa` as shown to keep quotes clean.
* **Parallel calls**: the model may emit **multiple** tool calls; handle each by id and send back multiple `role:"tool"` items in one `input` array. (Documented behavior of tool calls & output arrays.) ([OpenAI Platform][6])
