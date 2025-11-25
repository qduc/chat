# Tool Orchestration Deep Dive

This document provides an in-depth technical analysis of the tool orchestration system in ChatForge's backend. Tool orchestration is the core mechanism that enables the LLM to execute functions, gather information, and use that information to generate informed responses.

## Table of Contents

1. [Overview](#overview)
2. [Tool Registration and Discovery](#tool-registration-and-discovery)
3. [Tool Name Expansion](#tool-name-expansion)
4. [Tool Execution Flow](#tool-execution-flow)
5. [Streaming vs Non-Streaming Orchestration](#streaming-vs-non-streaming-orchestration)
6. [Multi-Turn Tool Loop](#multi-turn-tool-loop)
7. [Integration with LLM Providers](#integration-with-llm-providers)
8. [Tool Output Handling](#tool-output-handling)
9. [Persistence During Tool Orchestration](#persistence-during-tool-orchestration)
10. [Special Tool Behaviors](#special-tool-behaviors)
11. [Error Scenarios](#error-scenarios)
12. [Performance Optimizations](#performance-optimizations)

---

## Overview

Tool orchestration in ChatForge is an **iterative, server-side execution system** that:
- Detects when the LLM requests tool calls
- Executes tools synchronously (one at a time)
- Feeds tool results back to the LLM
- Continues until the LLM provides a final response

**Key Design Principles:**
1. **Server-side execution only** - Tools never execute on the client for security
2. **Iterative loop** - Multiple rounds of tool calls supported within a single request
3. **Two modes** - Streaming and non-streaming (JSON) orchestration
4. **User context propagation** - User ID flows through tool execution for user-scoped operations
5. **Final-only persistence** - Accumulate state during orchestration, write once at the end

**File Locations:**
- `backend/src/lib/toolOrchestrationUtils.js` - Core orchestration utilities
- `backend/src/lib/toolsStreaming.js` - Streaming mode orchestration
- `backend/src/lib/toolsJson.js` - Non-streaming (JSON) mode orchestration
- `backend/src/lib/tools/` - Tool implementations
- `backend/src/lib/openaiProxy.js` - Request routing and tool name expansion

---

## Tool Registration and Discovery

### Tool Registry Pattern

Tools are registered using a **centralized registry pattern** (`backend/src/lib/tools/index.js:1-30`):

```javascript
// Import all tools
import getTimeTool from './getTime.js';
import webSearchTool from './webSearch.js';
import webSearchExaTool from './webSearchExa.js';
import webSearchSearxngTool from './webSearchSearxng.js';
import webFetchTool from './webFetch.js';

// Register in array
const registeredTools = [
  getTimeTool,
  webSearchTool,
  webSearchExaTool,
  webSearchSearxngTool,
  webFetchTool
];

// Build Map for O(1) lookup by name
const toolMap = new Map();
for (const tool of registeredTools) {
  if (toolMap.has(tool.name)) {
    throw new Error(`Duplicate tool name detected: ${tool.name}`);
  }
  toolMap.set(tool.name, tool);
}

// Export as object for easy access
export const tools = Object.fromEntries(toolMap.entries());
```

### Tool Structure

Each tool is created using the `createTool` factory (`backend/src/lib/tools/baseTool.js:1-35`):

```javascript
export function createTool({ name, description, validate, handler, openAI }) {
  // Validation
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Tool name must be a non-empty string');
  }
  if (typeof handler !== 'function') {
    throw new Error(`Tool ${name} handler must be a function`);
  }
  if (!openAI || openAI.type !== 'function') {
    throw new Error(`Tool ${name} must provide an OpenAI-compatible specification`);
  }

  // Build spec
  const spec = {
    ...openAI,
    function: {
      ...openAI.function,
      name: openAI.function?.name || name,
      description: openAI.function?.description || description || '',
    },
  };

  return Object.freeze({
    name,               // Short name (e.g., "web_search")
    description,        // Human-readable description
    validate,          // Input validation function
    handler,           // Async execution function
    spec,              // Full OpenAI tool specification
  });
}
```

### Tool Implementation Example

Example from `backend/src/lib/tools/webSearch.js:266-326`:

```javascript
export const webSearchTool = createTool({
  name: 'web_search',
  description: 'Fast, high-quality search...',
  validate,    // Function that validates and normalizes arguments
  handler,     // Async function that executes the tool
  openAI: {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Fast, accurate search...',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to execute',
          },
          // ... more parameters
        },
        required: ['query'],
      },
    },
  },
});
```

### Tool Discovery Functions

```javascript
// Generate full OpenAI-compatible tool specs for all registered tools
export function generateOpenAIToolSpecs() {
  return registeredTools.map((tool) => tool.spec);
}

// Get list of available tool names
export function getAvailableTools() {
  return registeredTools.map((tool) => tool.name);
}
```

---

## Tool Name Expansion

The frontend can send **simplified tool names** (strings) instead of full OpenAI tool specifications. The backend expands these to full specs.

### Expansion Logic

Located in `backend/src/lib/openaiProxy.js:68-82`:

```javascript
// Allow a simplified tools representation from frontend: an array of tool names (strings).
// Expand into full OpenAI-compatible tool specs using server-side registry.
try {
  if (Array.isArray(bodyIn.tools) && bodyIn.tools.length > 0 && typeof bodyIn.tools[0] === 'string') {
    const toolSpecs = Array.isArray(helpers.toolSpecs) && helpers.toolSpecs.length > 0
      ? helpers.toolSpecs
      : generateOpenAIToolSpecs();
    const selected = toolSpecs.filter((spec) => bodyIn.tools.includes(spec.function?.name));
    body.tools = selected;
  }
} catch {
  // ignore expansion errors and let downstream validation handle unexpected shapes
}
```

### Example Transformation

**Frontend sends:**
```json
{
  "model": "gpt-4",
  "messages": [...],
  "tools": ["web_search", "web_fetch"]
}
```

**Backend expands to:**
```json
{
  "model": "gpt-4",
  "messages": [...],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "web_search",
        "description": "Fast, accurate search...",
        "parameters": { /* full JSON schema */ }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "web_fetch",
        "description": "Fetch content from URL...",
        "parameters": { /* full JSON schema */ }
      }
    }
  ]
}
```

---

## Tool Execution Flow

### Complete Flow Diagram

```
LLM Response with tool_calls
         ↓
Extract tool calls from response
         ↓
For each tool call:
  ├─ Look up tool in registry
  ├─ Parse JSON arguments
  ├─ Validate arguments
  ├─ Execute handler(args, context)
  ├─ Capture output
  └─ Format as tool result message
         ↓
Add tool results to conversation history
         ↓
Send updated history back to LLM
         ↓
Continue until LLM returns without tool_calls
```

### executeToolCall Function

Core execution logic in `backend/src/lib/toolOrchestrationUtils.js:635-671`:

```javascript
export async function executeToolCall(call, userId = null) {
  const name = call?.function?.name;
  const argsStr = call?.function?.arguments || '{}';
  const tool = toolRegistry[name];

  // 1. Tool lookup
  if (!tool) {
    return {
      name,
      output: `Error: Unknown tool '${name}'. Available tools: ${Object.keys(toolRegistry).join(', ')}.`
    };
  }

  // 2. Parse arguments
  let args;
  try {
    args = JSON.parse(argsStr || '{}');
  } catch (parseError) {
    return {
      name,
      output: `Error: Invalid JSON in tool arguments. ${parseError.message}`
    };
  }

  // 3. Validate and execute
  try {
    const validated = tool.validate ? tool.validate(args) : args;
    // Pass user context as second parameter for user-scoped tools
    const output = await tool.handler(validated, { userId });
    return { name, output };
  } catch (executionError) {
    return {
      name,
      output: `Error executing tool '${name}': ${executionError.message}`
    };
  }
}
```

### Tool Call Message Format

**LLM sends tool calls:**
```json
{
  "role": "assistant",
  "content": "Let me search for that information.",
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "web_search",
        "arguments": "{\"query\":\"latest news\"}"
      }
    }
  ]
}
```

**Backend adds tool result:**
```json
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "Search Results:\n1. Article title...\n   URL: https://..."
}
```

---

## Streaming vs Non-Streaming Orchestration

ChatForge supports two orchestration modes that differ in **how responses are delivered to the client**.

### Mode Selection

Located in `backend/src/lib/openaiProxy.js:296-303`:

```javascript
if (flags.hasTools) {
  // Tool orchestration path
  if (flags.streamToFrontend) {
    return handleToolsStreaming({ body, bodyIn, config, res, req, persistence, provider, userId });
  } else {
    return handleToolsJson({ body, bodyIn, config, res, req, persistence, provider, userId });
  }
}
```

### Streaming Mode (`handleToolsStreaming`)

**File:** `backend/src/lib/toolsStreaming.js`

**Characteristics:**
- Real-time Server-Sent Events (SSE) to client
- Content streamed as it arrives from LLM
- Tool calls accumulated, then sent as consolidated chunk
- Tool outputs streamed immediately after execution
- Early conversation metadata emission

**Key Implementation Details:**

1. **Stream Setup** (`toolsStreaming.js:52-53`):
```javascript
setupStreamingHeaders(res);
```

2. **Content Streaming** (`toolsStreaming.js:253-325`):
```javascript
upstream.body.on('data', (chunk) => {
  leftoverIter = parseSSEStream(chunk, leftoverIter, (obj) => {
    const delta = obj?.choices?.[0]?.delta || {};

    // Accumulate tool calls (don't stream partial tool call deltas)
    if (Array.isArray(delta.tool_calls)) {
      for (const tcDelta of delta.tool_calls) {
        const idx = tcDelta.index ?? 0;
        const existing = toolCallMap.get(idx) || {...};
        // Accumulate function name and arguments
        if (tcDelta.function?.name) existing.function.name = tcDelta.function.name;
        if (tcDelta.function?.arguments) existing.function.arguments += tcDelta.function.arguments;
        toolCallMap.set(idx, existing);
      }
    } else {
      // Stream non-tool deltas directly to client
      writeAndFlush(res, `data: ${JSON.stringify(obj)}\n\n`);
    }

    // Accumulate text content
    if (delta.content) {
      accumulatedContent += delta.content;
    }
    appendToPersistence(persistence, delta.content);
  });
});
```

3. **Consolidated Tool Call Emission** (`toolsStreaming.js:356-376`):
```javascript
const toolCalls = Array.from(toolCallMap.values());

if (toolCalls.length > 0) {
  // Normalize tool calls
  const normalizedToolCalls = toolCalls.map(tc => ({
    ...tc,
    function: {
      ...tc.function,
      arguments: tc.function.arguments || '{}'
    }
  }));

  // Emit single consolidated chunk with all tool calls
  const toolCallChunk = createChatCompletionChunk(
    bodyIn.id || 'chatcmpl-' + Date.now(),
    body.model,
    { tool_calls: normalizedToolCalls }
  );
  writeAndFlush(res, `data: ${JSON.stringify(toolCallChunk)}\n\n`);
}
```

4. **Tool Execution and Output Streaming** (`toolsStreaming.js:390-424`):
```javascript
for (const toolCall of normalizedToolCalls) {
  try {
    const { name, output } = await executeToolCall(toolCall, userId);

    // Stream tool output immediately
    streamDeltaEvent({
      res,
      model: body.model,
      event: { tool_output: { tool_call_id: toolCall.id, name, output } },
      prefix: 'iter'
    });

    // Buffer for persistence
    persistence.addToolOutputs([{
      tool_call_id: toolCall.id,
      output: toolContent,
      status: 'success'
    }]);

    // Add to conversation for next iteration
    conversationHistory.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: toolContent,
    });
  } catch (error) {
    // Stream error output
    streamDeltaEvent({
      res,
      model: body.model,
      event: { tool_output: { tool_call_id: toolCall.id, name, output: errorMessage } }
    });
  }
}
```

### Non-Streaming Mode (`handleToolsJson`)

**File:** `backend/src/lib/toolsJson.js`

**Characteristics:**
- Single JSON response at the end
- All tool events collected in `tool_events` array
- More predictable for testing and debugging
- Client can optionally stream the final response

**Key Implementation Details:**

1. **Response Handler Pattern** (`toolsJson.js:21-283`):

The code uses a **Strategy Pattern** with two concrete handlers:

```javascript
class StreamingResponseHandler extends ResponseHandler {
  sendThinkingContent(content, persistence) {
    this._streamEvent({ content });
    appendToPersistence(persistence, content);
  }

  sendToolCalls(toolCalls) {
    for (const toolCall of toolCalls) {
      this._streamEvent({ tool_calls: [toolCall] });
    }
  }

  sendToolOutputs(outputs, persistence) {
    for (const output of outputs) {
      this._streamEvent({ tool_output: output });
      persistence.addToolOutputs([{...}]);
    }
  }
}

class JsonResponseHandler extends ResponseHandler {
  sendThinkingContent(content, persistence) {
    this.collectedEvents.push({ type: 'text', value: content });
    appendToPersistence(persistence, content);
  }

  sendToolCalls(toolCalls) {
    for (const toolCall of toolCalls) {
      this.collectedEvents.push({ type: 'tool_call', value: toolCall });
    }
  }

  sendToolOutputs(outputs, persistence) {
    for (const output of outputs) {
      this.collectedEvents.push({ type: 'tool_output', value: output });
      persistence.addToolOutputs([{...}]);
    }
  }
}
```

2. **Tool Execution** (`toolsJson.js:329-381`):
```javascript
async function executeAllTools(toolCalls, responseHandler, persistence) {
  const toolResults = [];
  const toolOutputs = [];

  for (const toolCall of toolCalls) {
    try {
      const { name, output } = await executeToolCall(toolCall);

      const toolOutput = {
        tool_call_id: toolCall.id,
        name,
        output
      };

      toolOutputs.push(toolOutput);
      toolResults.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: typeof output === 'string' ? output : JSON.stringify(output),
      });
    } catch (error) {
      // Add error as tool result
      toolResults.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: errorMessage,
      });
    }
  }

  // Send all tool outputs through response handler
  responseHandler.sendToolOutputs(toolOutputs, persistence);
  return toolResults;
}
```

3. **Final Response Format** (`toolsJson.js:214-261`):
```javascript
sendFinalResponse(response, persistence) {
  const message = response?.choices?.[0]?.message;
  const finishReason = response?.choices?.[0]?.finish_reason || 'stop';
  const responseId = response?.id || null;

  if (message?.content) {
    this.collectedEvents.push({
      type: 'text',
      value: message.content
    });
    appendToPersistence(persistence, message.content);
  }

  recordFinalToPersistence(persistence, finishReason, responseId);

  const responseWithEvents = {
    ...response,
    tool_events: this.collectedEvents  // Array of all tool events
  };

  addConversationMetadata(responseWithEvents, persistence);
  return responseWithEvents;
}
```

### Comparison

| Feature | Streaming | Non-Streaming (JSON) |
|---------|-----------|---------------------|
| Response format | SSE (text/event-stream) | JSON (application/json) |
| Content delivery | Real-time chunks | Single response at end |
| Tool call visibility | Streamed after accumulation | In `tool_events` array |
| Tool output visibility | Streamed immediately | In `tool_events` array |
| Client complexity | Must parse SSE | Simple JSON parsing |
| User experience | Feels responsive | Feels slower for long tool chains |
| Testing | Harder to test streams | Easier to test JSON |

---

## Multi-Turn Tool Loop

Both orchestration modes support **iterative tool execution** within a single user request.

### Loop Structure

```
Iteration 1:
  Send messages → LLM responds with tool_calls
  Execute tools → Add results to messages

Iteration 2:
  Send messages (now includes tool results) → LLM responds with tool_calls
  Execute tools → Add results to messages

Iteration 3:
  Send messages (now includes more tool results) → LLM responds with final answer
  No tool_calls → Exit loop
```

### Loop Implementation (Streaming)

From `backend/src/lib/toolsStreaming.js:64-474`:

```javascript
const MAX_ITERATIONS = 10;

let iteration = 0;
let isComplete = false;
let currentPreviousResponseId = previousResponseId;

while (!isComplete && iteration < MAX_ITERATIONS) {
  iteration++;

  // Build request with tools
  let requestBody = {
    model: body.model,
    messages: conversationHistory,
    stream: providerStreamEnabled,
    tools: toolsToSend,
    tool_choice: body.tool_choice || 'auto',
    ...(currentPreviousResponseId && { previous_response_id: currentPreviousResponseId }),
  };

  // Make request to LLM
  const upstream = await createOpenAIRequest(config, requestBody, { providerId });

  // Parse response and accumulate tool calls
  const toolCalls = Array.from(toolCallMap.values());

  if (toolCalls.length > 0) {
    // Add assistant message with tool calls
    conversationHistory.push({
      role: 'assistant',
      content: accumulatedContent,
      tool_calls: normalizedToolCalls
    });

    // Execute each tool
    for (const toolCall of normalizedToolCalls) {
      const { name, output } = await executeToolCall(toolCall, userId);

      // Add tool result to conversation
      conversationHistory.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolContent,
      });
    }

    // Continue to next iteration
  } else {
    // No tool calls - this is the final response
    isComplete = true;
  }
}
```

### Loop Implementation (JSON)

From `backend/src/lib/toolsJson.js:572-673`:

```javascript
let iteration = 0;
let currentPreviousResponseId = previousResponseId;

while (iteration < orchestrationConfig.maxIterations) {
  // Always get non-streaming response first to check for tool calls
  const response = await callLLM({
    messages,
    config,
    bodyParams: { ...body, tools: orchestrationConfig.tools, stream: false },
    providerId,
    previousResponseId: currentPreviousResponseId,
    userId,
  });

  const message = response?.choices?.[0]?.message;
  const toolCalls = message?.tool_calls || [];

  // Update response_id for next iteration
  if (response?.id) {
    currentPreviousResponseId = response.id;
  }

  if (!toolCalls.length) {
    // No tools needed - final response
    return responseHandler.sendFinalResponse(response, persistence);
  }

  // Send thinking content
  if (message.content) {
    responseHandler.sendThinkingContent(message.content, persistence);
  }

  // Send tool calls
  responseHandler.sendToolCalls(toolCalls);

  // Execute all tools
  const toolResults = await executeAllTools(toolCalls, responseHandler, persistence);

  // Add to conversation for next iteration
  messages.push(message, ...toolResults);
  iteration++;
}
```

### Max Iterations Safety

Both implementations have a **safety limit** of 10 iterations:

```javascript
const MAX_ITERATIONS = 10;

if (iteration >= MAX_ITERATIONS) {
  const maxIterMsg = '\n\n[Maximum iterations reached]';
  responseHandler.sendThinkingContent(maxIterMsg, persistence);
  isComplete = true;
}
```

This prevents infinite loops if the LLM keeps requesting tools.

---

## Integration with LLM Providers

### Provider Abstraction

Tool orchestration works across multiple LLM providers (OpenAI, Anthropic, etc.) through a **provider abstraction layer**.

**Key Provider Methods:**

```javascript
class BaseProvider {
  supportsTools() {
    // Does this provider support function calling?
  }

  getToolsetSpec({ generateOpenAIToolSpecs, generateToolSpecs }) {
    // Get provider-specific tool format
  }

  shouldUseResponsesAPI() {
    // Does this provider support Responses API optimization?
  }

  supportsReasoningControls(model) {
    // Does this model support reasoning_effort, verbosity?
  }
}
```

### Tool Spec Selection

From `backend/src/lib/toolsStreaming.js:74-78`:

```javascript
// Prefer frontend-provided tools (already expanded)
// Otherwise fall back to server-side registry
const fallbackToolSpecs = providerInstance.getToolsetSpec({
  generateOpenAIToolSpecs,
  generateToolSpecs,
}) || generateOpenAIToolSpecs();

const toolsToSend = (Array.isArray(body.tools) && body.tools.length)
  ? body.tools
  : fallbackToolSpecs;
```

### Responses API Optimization

The system can use OpenAI's **Responses API** to avoid sending full conversation history on each turn.

From `backend/src/lib/toolOrchestrationUtils.js:537-561`:

```javascript
const supportsResponsesAPI = provider?.shouldUseResponsesAPI?.() ?? false;

if (persistence && persistence.conversationId && supportsResponsesAPI) {
  const previousResponseId = getLastAssistantResponseId({ conversationId });

  if (previousResponseId) {
    // Only send latest user message + previous_response_id
    // OpenAI manages conversation state server-side
    const messages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...latestUserMessage]
      : latestUserMessage;

    return { messages, previousResponseId };
  }
}
```

### Provider-Specific Request Building

From `backend/src/lib/toolsStreaming.js:79-100`:

```javascript
let requestBody = {
  model: body.model || config.defaultModel,
  messages: conversationHistory,
  stream: providerStreamEnabled,
  ...(toolsToSend && { tools: toolsToSend, tool_choice: body.tool_choice || 'auto' }),
  ...(currentPreviousResponseId && { previous_response_id: currentPreviousResponseId }),
};

// Include reasoning controls only if supported by provider
if (providerInstance.supportsReasoningControls(requestBody.model)) {
  if (body.reasoning_effort) requestBody.reasoning_effort = body.reasoning_effort;
  if (body.verbosity) requestBody.verbosity = body.verbosity;
}

// Apply prompt caching (provider-specific)
requestBody = await addPromptCaching(requestBody, {
  conversationId: persistence?.conversationId,
  userId,
  provider: providerInstance,
  hasTools: Boolean(toolsToSend)
});
```

---

## Tool Output Handling

### Output Format

Tool outputs are always stored as **string content** in conversation messages, even if the tool returns structured data.

From `backend/src/lib/toolsStreaming.js:391-424`:

```javascript
const { name, output } = await executeToolCall(toolCall, userId);

// Serialize output
const toolContent = typeof output === 'string'
  ? output
  : JSON.stringify(output);

// Add to conversation history
conversationHistory.push({
  role: 'tool',
  tool_call_id: toolCall.id,
  content: toolContent,
});
```

### Output Streaming (Streaming Mode)

Tool outputs are streamed to the client using a custom **tool_output event**:

```javascript
streamDeltaEvent({
  res,
  model: body.model,
  event: {
    tool_output: {
      tool_call_id: toolCall.id,
      name: toolCall.function?.name,
      output: toolContent
    }
  },
  prefix: 'iter'
});
```

Client receives:
```
data: {"id":"iter_1234","object":"chat.completion.chunk","model":"gpt-4","choices":[{"index":0,"delta":{"tool_output":{"tool_call_id":"call_abc","name":"web_search","output":"Results..."}},"finish_reason":null}]}
```

### Output Collection (JSON Mode)

Tool outputs are collected in the `tool_events` array:

```javascript
this.collectedEvents.push({
  type: 'tool_output',
  value: {
    tool_call_id: output.tool_call_id,
    name: output.name,
    output: output.output
  }
});
```

Final response includes:
```json
{
  "id": "chatcmpl-123",
  "choices": [...],
  "tool_events": [
    { "type": "text", "value": "Let me search for that..." },
    { "type": "tool_call", "value": {...} },
    { "type": "tool_output", "value": {"tool_call_id": "call_abc", "output": "..."} },
    { "type": "text", "value": "Based on the search results..." }
  ]
}
```

### Error Output Handling

Tool execution errors are captured and returned as tool outputs:

```javascript
try {
  const { name, output } = await executeToolCall(toolCall, userId);
  // ... success handling
} catch (error) {
  const errorMessage = `Tool ${toolCall.function?.name} failed: ${error.message}`;

  // Stream error as tool output
  streamDeltaEvent({
    res,
    model: body.model,
    event: { tool_output: { tool_call_id: toolCall.id, name, output: errorMessage } }
  });

  // Buffer error for persistence
  persistence.addToolOutputs([{
    tool_call_id: toolCall.id,
    output: errorMessage,
    status: 'error'
  }]);

  // Add error to conversation
  conversationHistory.push({
    role: 'tool',
    tool_call_id: toolCall.id,
    content: errorMessage,
  });
}
```

The LLM receives the error message and can respond appropriately (e.g., retry with different parameters, inform the user, etc.).

---

## Persistence During Tool Orchestration

Tool orchestration uses a **buffered, final-only persistence strategy** via the `SimplifiedPersistence` class.

### Persistence Initialization

From `backend/src/lib/openaiProxy.js:488-510`:

```javascript
const persistence = new SimplifiedPersistence(config);

const initResult = await persistence.initialize({
  conversationId: context.conversationId,
  sessionId,
  userId,
  req,
  bodyIn: context.bodyIn
});

if (initResult.error) {
  return res.status(initResult.error.statusCode).json({
    error: initResult.error.type,
    message: initResult.error.message,
  });
}
```

### Buffer Accumulation

During orchestration, the system **accumulates state in memory**:

1. **Content Accumulation** (`toolOrchestrationUtils.js:673-677`):
```javascript
export function appendToPersistence(persistence, content) {
  if (!persistence || !persistence.persist) return;
  if (typeof content !== 'string' || content.length === 0) return;
  persistence.appendContent(content);  // Buffer in memory
}
```

2. **Tool Call Buffering** (`toolsStreaming.js:386-388`):
```javascript
if (persistence && persistence.persist) {
  persistence.addToolCalls(normalizedToolCalls);  // Buffer in memory
}
```

3. **Tool Output Buffering** (`toolsStreaming.js:412-418`):
```javascript
if (persistence && persistence.persist) {
  persistence.addToolOutputs([{
    tool_call_id: toolCall.id,
    output: toolContent,
    status: 'success'
  }]);  // Buffer in memory
}
```

### Final Persistence

**Only at the end** of orchestration, the system writes to the database:

From `toolOrchestrationUtils.js:679-682`:

```javascript
export function recordFinalToPersistence(persistence, finishReason, responseId = null) {
  if (!persistence || !persistence.persist) return;
  persistence.recordAssistantFinal({ finishReason, responseId });  // Write to DB
}
```

This triggers:
1. Write assistant message with accumulated content
2. Write all buffered tool calls to `tool_calls` table
3. Write all buffered tool outputs to `tool_outputs` table
4. Update conversation metadata

### Text Offset Tracking

Tool calls track their **position in the assistant's text** for UI rendering:

From `streamingHandler.js:158-160`:

```javascript
// Capture textOffset when tool call first appears
if (isNewToolCall && persistence) {
  existing.textOffset = persistence.getContentLength();
}
```

This allows the UI to show: "Let me search for that. [Tool Call Here] Based on the results..."

### Reasoning Details Capture

Advanced models (like o1) include reasoning details that are captured:

```javascript
// From streaming
if (Array.isArray(delta.reasoning_details)) {
  persistence.setReasoningDetails(delta.reasoning_details);
}

// Reasoning tokens
const reasoningTokens = obj?.usage?.reasoning_tokens
  ?? obj?.usage?.completion_tokens_details?.reasoning_tokens;
if (reasoningTokens != null) {
  persistence.setReasoningTokens(reasoningTokens);
}
```

---

## Special Tool Behaviors

### User-Scoped Tools

Tools can access **user context** for user-specific operations.

**Example:** `web_search` tool checks for user-specific API keys:

From `backend/src/lib/tools/webSearch.js:127-144`:

```javascript
async function handler(args, context = {}) {
  // context may include userId when invoked from server orchestration
  const userId = context?.userId || null;
  let apiKey = null;

  if (userId) {
    try {
      // Use per-user API key from database
      const row = getUserSetting(userId, 'tavily_api_key');
      if (row && row.value) apiKey = row.value;
    } catch (err) {
      logger.warn('Failed to read user tavily_api_key', { userId, err });
    }
  }

  if (!apiKey) {
    throw new Error('Tavily API key is not configured. Please add it in Settings → Search & Web Tools.');
  }

  // ... execute search with apiKey
}
```

User ID propagation from orchestration:

```javascript
// In executeToolCall
const output = await tool.handler(validated, { userId });
```

### Tools Without Side Effects

Most tools are **read-only** and have no side effects:
- `web_search` - Searches the web
- `web_fetch` - Fetches URL content
- `get_time` - Returns current time

These can be safely retried and don't require transaction management.

### Tools With State

Currently not implemented, but the system could support tools that:
- Create resources (e.g., send email, create file)
- Modify state (e.g., update database)
- Have quota limits (e.g., paid API calls)

Such tools would need:
- Idempotency keys
- Transaction tracking
- Rollback on conversation deletion
- Cost tracking

---

## Error Scenarios

### Tool Not Found

From `toolOrchestrationUtils.js:640-645`:

```javascript
const tool = toolRegistry[name];

if (!tool) {
  return {
    name,
    output: `Error: Unknown tool '${name}'. Available tools: ${Object.keys(toolRegistry).join(', ')}.`
  };
}
```

LLM receives:
```
Error: Unknown tool 'invalid_tool'. Available tools: web_search, web_fetch, get_time, web_search_exa, web_search_searxng. Please check the tool name and try again.
```

### Invalid JSON Arguments

From `toolOrchestrationUtils.js:648-658`:

```javascript
try {
  args = JSON.parse(argsStr || '{}');
} catch (parseError) {
  return {
    name,
    output: `Error: Invalid JSON in tool arguments. Please check the JSON syntax and try again. Arguments received: ${argsStr}.`
  };
}
```

### Validation Errors

From `toolOrchestrationUtils.js:660-670`:

```javascript
try {
  const validated = tool.validate ? tool.validate(args) : args;
  const output = await tool.handler(validated, { userId });
  return { name, output };
} catch (executionError) {
  return {
    name,
    output: `Error executing tool '${name}': ${executionError.message}. Please check the arguments and try again.`
  };
}
```

Example validation error from `web_search`:

```javascript
if (!args || typeof args.query !== 'string' || args.query.trim().length === 0) {
  throw new Error('web_search requires a "query" argument of type string');
}
```

### API Errors

Tool implementations handle API-specific errors:

From `backend/src/lib/tools/webSearch.js:190-210`:

```javascript
if (!response.ok) {
  const errorBody = await response.text();
  let apiErrorMessage = '';

  try {
    const errorJson = JSON.parse(errorBody);
    apiErrorMessage = errorJson.error || errorJson.message || errorBody;
  } catch {
    apiErrorMessage = errorBody || 'Unknown error';
  }

  // 400 Bad Request - LLM can fix these by adjusting parameters
  if (response.status === 400) {
    throw new Error(`Invalid request parameters: ${apiErrorMessage}. Please adjust the tool call parameters and try again.`);
  }

  // 401/403 - Authentication/authorization issues (infra)
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Tavily API authentication failed: ${apiErrorMessage} (Verify your Tavily API key under Settings → Search & Web Tools)`
    );
  }

  // 429 - Rate limiting (infra)
  if (response.status === 429) {
    throw new Error(`Tavily API rate limit exceeded: ${apiErrorMessage} (API quota exhausted)`);
  }

  // 500+ - Server errors (infra)
  if (response.status >= 500) {
    throw new Error(`Tavily service error (${response.status}): ${apiErrorMessage} (Please try again later)`);
  }
}
```

### Stream Timeout

From `toolsStreaming.js:244-247`:

```javascript
const timeout = setTimeout(() => {
  reject(new Error('Stream timeout - no response from upstream API'));
}, config.providerConfig.streamTimeoutMs);
```

### Client Disconnect

Both modes handle client disconnections:

```javascript
req.on('close', () => {
  if (res.writableEnded) return;
  try {
    if (persistence && persistence.persist) {
      persistence.markError();
    }
  } catch {
    // Ignore errors
  }
});
```

### Upstream Error During Orchestration

From `toolsStreaming.js:500-520`:

```javascript
catch (error) {
  logger.error({ msg: '[iterative orchestration] error', err: error });

  // Stream error to client
  const errorMsg = `[Error: ${error.message}]`;
  streamDeltaEvent({
    res,
    model: body?.model,
    event: { content: errorMsg },
    prefix: 'iter',
  });

  appendToPersistence(persistence, errorMsg);
  if (persistence && persistence.persist) {
    persistence.markError();
  }

  emitConversationMetadata(res, persistence);
  streamDone(res);
  res.end();
}
```

---

## Performance Optimizations

### 1. Response API Optimization

**What:** Avoid sending full conversation history on each turn by using `previous_response_id`.

**Implementation:** `toolOrchestrationUtils.js:537-561`

```javascript
const supportsResponsesAPI = provider?.shouldUseResponsesAPI?.() ?? false;

if (persistence && persistence.conversationId && supportsResponsesAPI) {
  const previousResponseId = getLastAssistantResponseId({ conversationId });

  if (previousResponseId) {
    // Only send latest user message
    const latestUserMessage = allUserMessages[allUserMessages.length - 1];
    const messages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, latestUserMessage]
      : [latestUserMessage];

    return { messages, previousResponseId };
  }
}
```

**Benefit:** Reduces payload size and processing time for long conversations.

### 2. Prompt Caching

**What:** Cache system prompts and conversation history to reduce token processing costs.

**Implementation:** Applied before each LLM call:

```javascript
requestBody = await addPromptCaching(requestBody, {
  conversationId: persistence?.conversationId,
  userId,
  provider: providerInstance,
  hasTools: Boolean(toolsToSend)
});
```

**Benefit:** Reduces token costs and latency for repeated content.

### 3. Tool Call Accumulation

**What:** In streaming mode, accumulate partial tool call deltas before sending consolidated chunk.

**Why:** Partial tool call deltas are noisy and not useful to client. Consolidated tool calls are cleaner.

**Implementation:** `toolsStreaming.js:292-312`

```javascript
const toolCallMap = new Map(); // index -> accumulated tool call

if (Array.isArray(delta.tool_calls)) {
  for (const tcDelta of delta.tool_calls) {
    const idx = tcDelta.index ?? 0;
    const existing = toolCallMap.get(idx) || {...};

    // Accumulate function name and arguments
    if (tcDelta.function?.name) existing.function.name = tcDelta.function.name;
    if (tcDelta.function?.arguments) existing.function.arguments += tcDelta.function.arguments;

    toolCallMap.set(idx, existing);
  }
} else {
  // Stream non-tool deltas directly
  writeAndFlush(res, `data: ${JSON.stringify(obj)}\n\n`);
}
```

### 4. Final-Only Database Writes

**What:** Buffer all state in memory during orchestration, write once at the end.

**Why:** Reduces database round trips, improves performance, and simplifies transaction management.

**Implementation:** All content, tool calls, and tool outputs buffered via `SimplifiedPersistence`:

```javascript
// During orchestration
persistence.appendContent(delta.content);
persistence.addToolCalls(toolCalls);
persistence.addToolOutputs(outputs);

// At the end
persistence.recordAssistantFinal({ finishReason, responseId });
```

### 5. Sequential Tool Execution

**Current:** Tools execute sequentially (one at a time).

**Future Optimization:** Parallel tool execution for independent tools:

```javascript
// Current
for (const toolCall of toolCalls) {
  const output = await executeToolCall(toolCall, userId);
  results.push(output);
}

// Potential optimization
const results = await Promise.all(
  toolCalls.map(toolCall => executeToolCall(toolCall, userId))
);
```

**Considerations:**
- Some tools may have dependencies (execute sequentially)
- Rate limits may require throttling
- Error handling becomes more complex

### 6. Non-Streaming Check During Streaming

**What:** Always fetch non-streaming response first in JSON mode to check for tool calls.

**Why:** Avoids complex stream parsing just to detect tool calls.

**Implementation:** `toolsJson.js:578-589`

```javascript
// Always get non-streaming response first
const response = await callLLM({
  messages,
  config,
  bodyParams: { ...body, tools: orchestrationConfig.tools, stream: false },
  // ...
});

const toolCalls = response?.choices?.[0]?.message?.tool_calls || [];

if (!toolCalls.length) {
  // No tools - this is final response, can now stream it if client wants streaming
  return responseHandler.sendFinalResponse(response, persistence);
}
```

### 7. Early Metadata Emission

**What:** Send conversation metadata immediately after creating/loading conversation, before LLM response.

**Why:** Client receives conversation ID instantly, improving perceived performance.

**Implementation:** `streamingHandler.js:96-104`

```javascript
// Emit conversation metadata upfront so clients receive
// the conversation id before any model chunks or [DONE]
try {
  const conversationMeta = getConversationMetadata(persistence);
  if (conversationMeta) {
    writeAndFlush(res, `data: ${JSON.stringify(conversationMeta)}\n\n`);
  }
} catch (e) {
  logger.warn('[stream] failed to write conversation metadata early', e);
}
```

---

## Summary

Tool orchestration in ChatForge is a **sophisticated, iterative system** that enables LLMs to execute server-side functions and use the results to generate informed responses.

### Key Takeaways

1. **Server-side execution** - Tools never run on the client for security and user data isolation
2. **Two modes** - Streaming (real-time) and JSON (batch), both supporting multi-turn loops
3. **Iterative loop** - Supports multiple rounds of tool calls within a single user request
4. **User-scoped** - User context flows through tool execution for personalized behavior
5. **Provider-agnostic** - Works across OpenAI, Anthropic, and other providers
6. **Buffered persistence** - Accumulate state in memory, write once at the end
7. **Robust error handling** - All errors captured and fed back to LLM for recovery
8. **Optimized for performance** - Response API, prompt caching, early metadata emission

### Architecture Highlights

- **Registry pattern** for tool discovery (`tools/index.js`)
- **Strategy pattern** for response handling (`toolsJson.js`)
- **Factory pattern** for tool creation (`baseTool.js`)
- **Accumulator pattern** for streaming tool calls (`toolsStreaming.js`)
- **Final-only persistence** for database writes (`SimplifiedPersistence`)

### Future Enhancements

- **Parallel tool execution** for independent tools
- **Tool result caching** to avoid redundant calls
- **Tool quota management** for paid APIs
- **Transactional tools** with rollback support
- **Tool call approval** for sensitive operations
- **Dynamic tool registration** without code changes
