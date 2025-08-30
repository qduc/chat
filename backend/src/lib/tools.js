// Internal tool registry for server-side orchestration
// Keep tools simple, validated, and side-effect free where possible

export const tools = {
  // MVP tool: returns the current time
  // No arguments; returns ISO string and a human-friendly format
  get_time: {
    validate: (args) => {
      if (args && Object.keys(args).length > 0) {
        throw new Error('get_time takes no arguments');
      }
      return {};
    },
    handler: async () => {
      const now = new Date();
      const iso = now.toISOString();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const human = now.toLocaleString(undefined, {
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
      });
      return { iso, human, timezone: tz };
    },
  },

  // New tool: performs a web search using Tavily's LLM-native API
  web_search: {
    validate: (args) => {
      if (!args || typeof args.query !== 'string') {
        throw new Error('web_search requires a "query" argument of type string');
      }
      return { query: args.query };
    },
    handler: async ({ query }) => {
      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) {
        throw new Error('TAVILY_API_KEY environment variable is not set');
      }

      const url = 'https://api.tavily.com/search';

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_key: apiKey,
            query: query,
            search_depth: 'basic', // Use advanced for more comprehensive results
            include_answer: 'basic',      // Get a direct answer for the query
            max_results: 5,            // Get a few top results
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Tavily API request failed with status ${response.status}: ${errorBody}`);
        }

        const results = await response.json();

        // Tavily's response with `include_answer` is already LLM-friendly.
        // We can return the answer directly, and supplement with search results.
        let output = '';
        if (results.answer) {
          output += `Answer: ${results.answer}\n\n`;
        }

        if (results.results && results.results.length > 0) {
          output += 'Search Results:\n';
          results.results.forEach((r, i) => {
            output += `${i + 1}. ${r.title}\n   Content: ${r.content}\n   URL: ${r.url}\n`;
          });
        }

        return output.trim() || 'No results found.';

      } catch (error) {
        console.error('Error performing web search with Tavily:', error);
        throw new Error('Failed to fetch search results from Tavily');
      }
    },
  },
};

/**
 * Generate OpenAI-compatible tool specifications from internal tool registry
 * @returns {Array} OpenAI tool specifications
 */
export function generateOpenAIToolSpecs() {
  return [
    {
      type: 'function',
      function: {
        name: 'get_time',
        description: 'Get the current time in ISO format with timezone information',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function', 
      function: {
        name: 'web_search',
        description: 'Perform a web search using Tavily API to get current information',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query to execute'
            }
          },
          required: ['query']
        }
      }
    }
  ];
}

// Generic alias for future multi-provider use
export function generateToolSpecs() {
  return generateOpenAIToolSpecs();
}

/**
 * Get available tool names
 * @returns {Array<string>} Available tool names
 */
export function getAvailableTools() {
  return Object.keys(tools);
}
