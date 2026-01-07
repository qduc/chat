# Tool Development Guide

## Overview

ChatForge implements server-side tool orchestration with a modular, registry-based system. Tools are independent units that execute on the backend and can handle complex workflows with iterative and parallel execution.

## Tool Architecture

### Directory Structure

Tools are organized in the `backend/src/lib/tools/` directory:

```
backend/src/lib/tools/
  baseTool.js           # createTool factory function
  index.js              # Tool registry and exports
  webSearch.js          # Tavily web search
  webSearchExa.js       # Exa semantic search
  webSearchSearxng.js   # SearXNG meta-search
  webFetch.js           # Web page content extraction
  journal.js            # Persistent memory storage
```

### The createTool Factory

All tools use the `createTool` factory from `baseTool.js`:

```javascript
import { createTool } from './baseTool.js';

export const myTool = createTool({
  name: 'tool_name',
  description: 'Human-readable description of what the tool does',
  validate: (args) => {
    // Validate and normalize arguments
    // Throw Error if validation fails
    // Return validated/normalized arguments object
    return validatedArgs;
  },
  handler: async (validatedArgs, context = {}) => {
    // Implement tool logic
    // context contains userId for user-scoped operations
    return result;
  },
  openAI: {
    type: 'function',
    function: {
      name: 'tool_name',
      description: 'Description for the AI model',
      parameters: {
        type: 'object',
        properties: {
          param1: {
            type: 'string',
            description: 'Description of param1',
          },
        },
        required: ['param1'],
      },
    },
  },
});

export default myTool;
```

The factory validates the tool definition and returns a frozen object with:
- `name` - Tool identifier
- `description` - Human-readable description
- `validate` - Argument validation function
- `handler` - Execution function
- `spec` - OpenAI-compatible tool specification

### Tool Registration

Tools are registered in `backend/src/lib/tools/index.js`:

```javascript
import webSearchTool from './webSearch.js';
import webSearchExaTool from './webSearchExa.js';
import webSearchSearxngTool from './webSearchSearxng.js';
import webFetchTool from './webFetch.js';
import journalTool from './journal.js';

const registeredTools = [
  webSearchTool,
  webSearchExaTool,
  webSearchSearxngTool,
  webFetchTool,
  journalTool
];

const toolMap = new Map();
for (const tool of registeredTools) {
  if (toolMap.has(tool.name)) {
    throw new Error(`Duplicate tool name detected: ${tool.name}`);
  }
  toolMap.set(tool.name, tool);
}

export const tools = Object.fromEntries(toolMap.entries());

export function generateOpenAIToolSpecs() {
  return registeredTools.map((tool) => tool.spec);
}

export function getAvailableTools() {
  return registeredTools.map((tool) => tool.name);
}
```

## Adding New Tools

### Step 1: Create the Tool File

Create a new file in `backend/src/lib/tools/`:

```javascript
import { createTool } from './baseTool.js';
import { logger } from '../../logger.js';
import { getUserSetting } from '../../db/userSettings.js';

const TOOL_NAME = 'my_tool';

function validate(args) {
  if (!args || typeof args.query !== 'string' || args.query.trim().length === 0) {
    throw new Error('my_tool requires a "query" argument of type string');
  }

  const validated = { query: args.query.trim() };

  // Validate optional parameters
  if (args.maxResults !== undefined) {
    const maxResults = Number(args.maxResults);
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 20) {
      throw new Error('maxResults must be an integer between 1 and 20');
    }
    validated.maxResults = maxResults;
  }

  return validated;
}

async function handler(validatedArgs, context = {}) {
  // Extract userId from context for user-scoped operations
  const userId = context?.userId || null;

  // Example: Get per-user API key
  let apiKey = null;
  if (userId) {
    try {
      const row = getUserSetting(userId, 'my_tool_api_key');
      if (row && row.value) apiKey = row.value;
    } catch (err) {
      logger.warn('Failed to read user API key', { userId, err: err?.message });
    }
  }

  if (!apiKey) {
    throw new Error('API key not configured. Please add it in Settings.');
  }

  // Implement tool logic
  try {
    const results = await performOperation(validatedArgs, apiKey);
    return formatResults(results);
  } catch (error) {
    logger.error('Tool execution failed:', error);
    throw new Error(`Tool failed: ${error.message}`);
  }
}

export const myTool = createTool({
  name: TOOL_NAME,
  description: 'Description for humans',
  validate,
  handler,
  openAI: {
    type: 'function',
    function: {
      name: TOOL_NAME,
      description: 'Description for AI model - explain when to use this tool',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The query to process',
          },
          maxResults: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'Maximum results to return (default: 10)',
          },
        },
        required: ['query'],
      },
    },
  },
});

export default myTool;
```

### Step 2: Register the Tool

Add your tool to `backend/src/lib/tools/index.js`:

```javascript
import myTool from './myTool.js';

const registeredTools = [
  // ... existing tools
  myTool,
];
```

### Validation Function

The `validate` function:
- Receives raw arguments from the API
- Should validate all input parameters thoroughly
- Should throw an error with a descriptive message if validation fails
- Should return the normalized/validated arguments object
- Is called before the handler

### Handler Function

The `handler` function:
- Receives validated arguments as the first parameter
- Receives a `context` object as the second parameter containing `userId`
- Can be async for I/O operations
- Should return result data (not throw errors for expected failures)
- Should handle errors gracefully and provide meaningful messages

### The Context Parameter

Handlers receive a `context` object with user information:

```javascript
async function handler(validatedArgs, context = {}) {
  const userId = context?.userId || null;

  if (!userId) {
    throw new Error('This tool requires an authenticated user');
  }

  // Use userId for user-scoped operations
}
```

### Per-User API Keys

Tools that require external API keys should use the user settings system:

```javascript
import { getUserSetting } from '../../db/userSettings.js';

async function handler(args, context = {}) {
  const userId = context?.userId || null;

  let apiKey = null;
  if (userId) {
    try {
      const row = getUserSetting(userId, 'my_api_key');
      if (row && row.value) apiKey = row.value;
    } catch (err) {
      logger.warn('Failed to read API key', { userId, err: err?.message });
    }
  }

  if (!apiKey) {
    throw new Error('API key not configured. Please add it in Settings.');
  }
}
```

## Built-in Tools

### web_search (Tavily)

Fast, high-quality search with excellent default relevance. Best for quick answers, news/current events, and general queries.

**API Key**: `tavily_api_key` (per-user setting)

**Parameters**:
- `query` (required) - Search query
- `search_depth` - "basic" (default) or "advanced"
- `days` - Number of days for news topic
- `time_range` - "day", "week", "month", "year"
- `max_results` - 1-20 (default: 5)
- `include_answer` - "basic" or "advanced" for AI-generated answers
- `include_domains` - Array of domains to include
- `exclude_domains` - Array of domains to exclude

### web_search_exa (Exa)

Deep research with semantic search and custom content extraction. Best for technical queries, detailed specs, and when you need precise excerpts or AI summaries.

**API Key**: `exa_api_key` (per-user setting)

**Parameters**:
- `query` (required) - Search query
- `type` - "auto", "keyword", or "neural"
- `num_results` - 1-100 (default: 10)
- `include_domains` - Array of domains to include
- `exclude_domains` - Array of domains to exclude
- `text` - Boolean or object for full text retrieval
- `highlights` - Boolean or object for key excerpts
- `summary` - Boolean or object for AI summaries

### web_search_searxng (SearXNG)

Meta-search aggregating results from multiple engines. Self-hosted option for privacy-conscious users.

**Configuration**: `searxng_base_url` (per-user setting)

**Parameters**:
- `query` (required) - Search query
- `category` - "general", "news", "science", "it"
- `time_range` - "day", "week", "month", "year"
- `max_results` - 1-20 (default: 10)

### web_fetch

Fetch web pages and convert to Markdown. Supports JavaScript-heavy sites via Playwright browser automation. Includes specialized extractors for Reddit and StackOverflow.

**Parameters**:
- `url` (required for initial fetch) - URL to fetch
- `max_chars` - Maximum characters per chunk (default: 10000)
- `heading` - Array of headings to extract specific sections
- `continuation_token` - Token for fetching next chunk
- `use_browser` - Force browser rendering for SPAs

**Features**:
- Automatic table of contents generation
- Content extraction with Readability
- SPA detection and browser fallback
- Specialized extractors for Reddit (posts + comments) and StackOverflow (Q&A with votes)

### journal

Persistent memory for AI to store and retrieve notes across conversations. User-scoped entries.

**Parameters**:
- `mode` (required) - "write" or "read"
- `name` - Model name (required for write)
- `content` - Note content (required for write)
- `page` - Page number for read (default: 1)

## Best Practices

### Error Handling

- Validate inputs thoroughly in the `validate` function
- Return meaningful error messages that help the AI adjust its approach
- Distinguish between recoverable errors (bad parameters) and infrastructure errors (API down)
- Log errors for debugging with appropriate context

```javascript
// 400 Bad Request - AI can fix by adjusting parameters
if (response.status === 400) {
  throw new Error(`Invalid parameters: ${message}. Please adjust and try again.`);
}

// 401/403 - Configuration issue
if (response.status === 401 || response.status === 403) {
  throw new Error(`Authentication failed. Check API key in Settings.`);
}

// 429 - Rate limiting
if (response.status === 429) {
  throw new Error(`Rate limit exceeded. Please try again later.`);
}
```

### Performance

- Use async/await for I/O operations
- Implement timeouts for external calls
- Return only necessary data to minimize token usage
- Consider caching for frequently accessed data

### Security

- Validate all user inputs
- Never expose API keys in error messages
- Sanitize output if used in other contexts
- Enforce rate limits if applicable

## Parallel Tool Execution

The backend supports parallel execution for independent tool calls, reducing latency when the model requests multiple tools simultaneously.

### Request-Level Control

Per-request parameters:
- `enable_parallel_tool_calls` (boolean) - Enable parallel execution for this request
- `parallel_tool_concurrency` (number) - Max concurrent tool executions (bounded by server max)

### Server-Level Configuration

Environment variables:
- `ENABLE_PARALLEL_TOOL_CALLS` (boolean, default: false) - Enable feature globally
- `PARALLEL_TOOL_CONCURRENCY` (number, default: 3) - Default max concurrency

### Behavior

- Parallel execution is opt-in for backward compatibility
- Streaming flows emit `tool_output` events as each tool completes
- Conversation history preserves original tool-call order for the LLM
- Use conservatively for tools making heavy external requests

## Tool Orchestration

The tool orchestration system:
- Executes tools based on AI model requests
- Supports iterative tool calling (multiple rounds)
- Supports parallel tool execution (configurable)
- Integrates results back into the conversation
- Handles streaming of tool execution progress
- Persists checkpoints for recovery from disconnects

See [tool_orchestration_deep_dive.md](tool_orchestration_deep_dive.md) for detailed information about the orchestration engine.

## API Endpoint

The `/v1/tools` endpoint returns available tools:

```bash
curl http://localhost:3001/v1/tools \
  -H "Authorization: Bearer <token>"
```

Response includes tool schemas formatted for your AI provider.

## Configuration

Provider and tool credentials are stored per user. Open **Settings -> Search & Web Tools** in the app to configure:

- **Tavily API Key** - For `web_search` tool
- **Exa API Key** - For `web_search_exa` tool
- **SearXNG Base URL** - For `web_search_searxng` tool

No environment variables are required for these tools - they use per-user settings.

## Testing Tools

When adding new tools, include tests:

```javascript
import { describe, it, expect } from 'vitest';
import { myTool } from './myTool.js';

describe('my_tool', () => {
  describe('validate', () => {
    it('should require query parameter', () => {
      expect(() => myTool.validate({})).toThrow('requires a "query" argument');
    });

    it('should validate maxResults range', () => {
      expect(() => myTool.validate({
        query: 'test',
        maxResults: 100
      })).toThrow('must be an integer between 1 and 20');
    });

    it('should return validated args', () => {
      const result = myTool.validate({ query: '  test  ', maxResults: 5 });
      expect(result).toEqual({ query: 'test', maxResults: 5 });
    });
  });

  describe('handler', () => {
    it('should require authenticated user', async () => {
      await expect(myTool.handler({ query: 'test' }, {}))
        .rejects.toThrow('requires an authenticated user');
    });
  });
});
```
