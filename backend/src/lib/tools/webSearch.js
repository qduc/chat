import { createTool } from './baseTool.js';

const TOOL_NAME = 'web_search';

function validate(args) {
  if (!args || typeof args.query !== 'string' || args.query.trim().length === 0) {
    throw new Error('web_search requires a "query" argument of type string');
  }
  return { query: args.query.trim() };
}

async function handler({ query }) {
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
        query,
        search_depth: 'basic',
        include_answer: 'basic',
        max_results: 5,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Tavily API request failed with status ${response.status}: ${errorBody}`);
    }

    const results = await response.json();
    let output = '';

    if (results.answer) {
      output += `Answer: ${results.answer}\n\n`;
    }

    if (Array.isArray(results.results) && results.results.length > 0) {
      output += 'Search Results:\n';
      results.results.forEach((result, index) => {
        output += `${index + 1}. ${result.title}\n   Content: ${result.content}\n   URL: ${result.url}\n`;
      });
    }

    return output.trim() || 'No results found.';
  } catch (error) {
    console.error('Error performing web search with Tavily:', error);
    throw new Error('Failed to fetch search results from Tavily');
  }
}

export const webSearchTool = createTool({
  name: TOOL_NAME,
  description: 'Perform a web search using Tavily API to get current information',
  validate,
  handler,
  openAI: {
    type: 'function',
    function: {
      name: TOOL_NAME,
      description: 'Perform a web search using Tavily API to get current information',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to execute',
          },
        },
        required: ['query'],
      },
    },
  },
});

export default webSearchTool;
