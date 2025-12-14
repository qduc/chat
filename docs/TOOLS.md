# Tool Development Guide

## Overview

ChatForge implements server-side tool orchestration with a modular, registry-based system. Tools are independent units that execute on the backend and can handle complex workflows with iterative execution.

## Adding New Tools

### Tool Structure

Tools are defined in `backend/src/lib/tools.js` with a consistent interface:

```javascript
export const tools = {
  your_tool_name: {
    validate: (args) => {
      // Validate and normalize arguments
      if (!args?.requiredParam) {
        throw new Error('Missing requiredParam');
      }
      return { requiredParam: args.requiredParam };
    },
    handler: async (validatedArgs) => {
      // Implement tool logic
      return { result: 'success' };
    },
  },
};
```

### Tool Registration

1. **Define the tool** in `backend/src/lib/tools.js`
2. **Export it** from the tools module
3. **Register in the tool system** - Automatically discovered via the registry

Tools are automatically registered and available via the `/v1/tools` endpoint.

### Validation Function

The `validate` function:
- Receives raw arguments from the API
- Should validate all input parameters
- Should throw an error with a descriptive message if validation fails
- Should return the normalized/validated arguments object

```javascript
validate: (args) => {
  const errors = [];

  if (!args?.query) {
    errors.push('query is required');
  }

  if (args?.maxResults && typeof args.maxResults !== 'number') {
    errors.push('maxResults must be a number');
  }

  if (errors.length > 0) {
    throw new Error(`Validation errors: ${errors.join(', ')}`);
  }

  return {
    query: args.query,
    maxResults: args.maxResults || 10,
  };
}
```

### Handler Function

The `handler` function:
- Receives validated arguments
- Can be async for I/O operations
- Should return result data (not thrown errors)
- Should gracefully handle edge cases

```javascript
handler: async (validatedArgs) => {
  try {
    const results = await performSearch(validatedArgs.query);
    return {
      success: true,
      results: results.slice(0, validatedArgs.maxResults),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}
```

## Tool Interface Definition

For the chat completions API, tools must define their schema for the AI model:

```javascript
{
  type: 'function',
  function: {
    name: 'tool_name',
    description: 'Clear description of what the tool does',
    parameters: {
      type: 'object',
      properties: {
        param1: {
          type: 'string',
          description: 'Description of param1',
        },
        param2: {
          type: 'number',
          description: 'Description of param2',
        },
      },
      required: ['param1'],
    },
  },
}
```

## Best Practices

### Error Handling

- Validate inputs thoroughly in the `validate` function
- Return meaningful error messages
- Handle external API failures gracefully
- Log errors for debugging

### Performance

- Use async/await for I/O operations
- Implement timeouts for external calls
- Cache frequently used data when appropriate
- Return only necessary data

### Security

- Validate all user inputs
- Sanitize output if used in other contexts
- Never expose sensitive information in errors
- Enforce rate limits if applicable

### Documentation

- Add clear descriptions of tool purpose
- Document all parameters
- Provide examples of usage
- Document any rate limits or quotas

## Example: Web Search Tool

```javascript
web_search: {
  validate: (args) => {
    if (!args?.query) {
      throw new Error('query is required');
    }
    if (args.query.length > 500) {
      throw new Error('query must be less than 500 characters');
    }
    return {
      query: args.query.trim(),
      maxResults: Math.min(args.maxResults || 10, 20),
    };
  },

  handler: async (validatedArgs) => {
    try {
      const results = await searchWeb(validatedArgs.query);
      return {
        success: true,
        results: results.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
        })).slice(0, validatedArgs.maxResults),
      };
    } catch (error) {
      return {
        success: false,
        error: `Search failed: ${error.message}`,
      };
    }
  },
}
```

## Testing Tools

When adding new tools, include tests:

```javascript
describe('your_tool_name', () => {
  it('should validate required parameters', () => {
    expect(() => {
      tools.your_tool_name.validate({});
    }).toThrow('Missing required parameter');
  });

  it('should handle successful execution', async () => {
    const result = await tools.your_tool_name.handler({
      param1: 'test value',
    });
    expect(result.success).toBe(true);
  });
});
```

## Built-in Tools

ChatForge includes several built-in tools:

- **web_search** - Search the web using configured search providers
- **journal** - Store and retrieve persistent memory entries
- **file_upload** - Handle file attachments
- **image_upload** - Handle image attachments

## Tool Orchestration

The tool orchestration system:
- Executes tools based on AI model requests
- Supports iterative tool calling (tool calls multiple rounds)
- Integrates results back into the conversation
- Handles streaming of tool execution progress

See [tool_orchestration_deep_dive.md](tool_orchestration_deep_dive.md) for detailed information about the orchestration engine.

## API Endpoint

The `/v1/tools` endpoint returns available tools:

```bash
curl http://localhost:3001/v1/tools \
  -H "Authorization: Bearer <token>"
```

Response includes tool schemas formatted for your AI provider.

## Configuration

Provider and tool credentials are now stored per user. Open **Settings → Search & Web Tools** in the app to add:

- **Tavily API Key** (for the `web_search` tool)
- **Exa API Key** (for the `web_search_exa` tool)
- **SearXNG Base URL** (for the `web_search_searxng` tool)

No additional environment variables are required for these tools anymore.

### Parallel tool execution (opt-in)

The backend supports an opt-in parallel execution mode for tool calls. This can reduce latency when the model requests multiple independent tools.

Environment variables:

- `ENABLE_PARALLEL_TOOL_CALLS` (boolean, default: false) — enable the server-level feature flag
- `PARALLEL_TOOL_CONCURRENCY` (number, default: 3) — default max concurrent tool executions

Request-level overrides (per-call):

- `enable_parallel_tool_calls` (boolean) — opt a single request into parallel tool execution
- `parallel_tool_concurrency` (number) — override concurrency for a specific request (bounded by server max)

Notes:

- Parallel execution is opt-in and disabled by default for backward compatibility.
- Streaming behavior: when enabled in streaming flows the server will stream `tool_output` events as each tool completes; the conversation history and persistence will preserve the original tool-call order so the LLM's next iteration sees results in the expected sequence.
- Use conservatively for tools that make heavy external requests — tune concurrency with `PARALLEL_TOOL_CONCURRENCY`.
