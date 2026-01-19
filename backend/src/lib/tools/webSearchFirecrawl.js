import { createTool } from './baseTool.js';
import { logger } from '../../logger.js';
import { getUserSetting } from '../../db/userSettings.js';

const TOOL_NAME = 'web_search_firecrawl';

function validate(args) {
  if (!args || typeof args.query !== 'string' || args.query.trim().length === 0) {
    throw new Error('web_search_firecrawl requires a "query" argument of type string');
  }

  const validated = {
    query: args.query.trim(),
  };

  if (args.page_options !== undefined) {
    if (typeof args.page_options !== 'object' || args.page_options === null) {
      throw new Error('page_options must be an object');
    }
    validated.pageOptions = args.page_options;
  }

  if (args.search_options !== undefined) {
    if (typeof args.search_options !== 'object' || args.search_options === null) {
      throw new Error('search_options must be an object');
    }
    validated.searchOptions = args.search_options;
  }

  return validated;
}

async function handler({ query, pageOptions, searchOptions }, context = {}) {
  const userId = context?.userId || null;
  let apiKey = null;
  let baseUrl = 'https://api.firecrawl.dev';

  if (userId) {
    try {
      const keyRow = getUserSetting(userId, 'firecrawl_api_key');
      if (keyRow && keyRow.value) apiKey = keyRow.value;

      const urlRow = getUserSetting(userId, 'firecrawl_base_url');
      if (urlRow && urlRow.value) baseUrl = urlRow.value;
    } catch (err) {
      logger.warn('Failed to read user firecrawl settings from DB', { userId, err: err?.message || err });
    }
  }

  if (!apiKey) {
    // Some self-hosted instances might not require an API key, but typically it's needed.
    // We'll warn but proceed if user is using a custom base URL, otherwise require it for the cloud version.
    if (baseUrl === 'https://api.firecrawl.dev') {
      throw new Error('Firecrawl API key is not configured. Please add it in Settings → Search & Web Tools.');
    }
  }

  // Ensure base URL doesn't end with slash
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const url = `${cleanBaseUrl}/v1/search`;

  const requestBody = {
    query,
    pageOptions,
    searchOptions,
  };

  try {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let apiErrorMessage = '';

      try {
        const errorJson = JSON.parse(errorBody);
        apiErrorMessage = errorJson.error || errorJson.message || errorBody;
      } catch {
        apiErrorMessage = errorBody || 'Unknown error';
      }

      throw new Error(`Firecrawl API request failed with status ${response.status}: ${apiErrorMessage}`);
    }

    const results = await response.json();
    let output = '';

    if (results.success && Array.isArray(results.data) && results.data.length > 0) {
      output += 'Search Results:\n\n';
      results.data.forEach((result, index) => {
        const title = result.title || result.url || `Result ${index + 1}`;
        output += `${index + 1}. ${title}\n`;

        if (result.description) {
            output += `   Description: ${result.description}\n`;
        }

        if (result.markdown) {
          // Truncate markdown if it's too long to avoid context window explosion,
          // though typically verify/extract steps handle this.
          // For now, let's keep a reasonable snippet if it's massive, or just include it.
          // Let's rely on the LLM to handle it, or maybe truncate reasonably?
          // Firecrawl search usually returns snippets or full pages based on options.
          // Let's limit to 500 chars for the "snippet" view in chat.
          const snippet = result.markdown.slice(0, 500).replace(/\n/g, ' ');
          output += `   Snippet: ${snippet}...\n`;
        }

        if (result.url) {
          output += `   URL: ${result.url}\n`;
        }
        output += '\n';
      });
    } else {
        output = 'No results found.';
    }

    return output.trim();

  } catch (error) {
    logger.error('Error performing web search with Firecrawl:', error);
    throw error;
  }
}

export const webSearchFirecrawlTool = createTool({
  name: TOOL_NAME,
  description: 'Search the web using Firecrawl, a tool capable of scraping and crawling websites to convert them into clean markdown. Supports local instances.',
  validate,
  handler,
  openAI: {
    type: 'function',
    function: {
      name: TOOL_NAME,
      description: 'Search the web using Firecrawl. Use this for general web search, especially when you need clean markdown content from results.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query string.',
          },
          page_options: {
            type: 'object',
            description: 'Optional configuration for page fetching (e.g. onlyMainContent, fetchPageContent).',
            properties: {
                onlyMainContent: { type: 'boolean' },
                fetchPageContent: { type: 'boolean' },
                includeHtml: { type: 'boolean' },
            }
          },
          search_options: {
            type: 'object',
            description: 'Optional configuration for search (e.g. limit).',
            properties: {
                limit: { type: 'integer', description: 'Max number of results' }
            }
          }
        },
        required: ['query'],
      },
    },
  },
});

export default webSearchFirecrawlTool;
