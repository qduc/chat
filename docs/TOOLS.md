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

Tool behavior can be configured via environment variables:

- `TAVILY_API_KEY` - Tavily web search API key
- `EXA_API_KEY` - Exa web search API key
- `SEARXNG_BASE_URL` - SearXNG instance URL

See [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for complete configuration options.
