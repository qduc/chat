import { createTool } from './baseTool.js';
import { logger } from '../../logger.js';

const TOOL_NAME = 'web_search_searxng';

function validate(args) {
  if (!args || typeof args.query !== 'string' || args.query.trim().length === 0) {
    throw new Error('web_search_searxng requires a "query" argument of type string');
  }

  const validated = { query: args.query.trim() };

  // Optional parameters with validation
  if (args.categories !== undefined) {
    if (typeof args.categories !== 'string' || args.categories.trim().length === 0) {
      throw new Error('categories must be a non-empty string');
    }
    validated.categories = args.categories.trim();
  }

  if (args.engines !== undefined) {
    if (typeof args.engines !== 'string' || args.engines.trim().length === 0) {
      throw new Error('engines must be a non-empty string');
    }
    validated.engines = args.engines.trim();
  }

  if (args.language !== undefined) {
    if (typeof args.language !== 'string' || args.language.trim().length === 0) {
      throw new Error('language must be a non-empty string');
    }
    validated.language = args.language.trim();
  }

  if (args.pageno !== undefined) {
    const pageno = Number(args.pageno);
    if (!Number.isInteger(pageno) || pageno < 1) {
      throw new Error('pageno must be a positive integer');
    }
    validated.pageno = pageno;
  }

  if (args.time_range !== undefined) {
    if (!['day', 'week', 'month', 'year'].includes(args.time_range)) {
      throw new Error('time_range must be one of: "day", "week", "month", "year"');
    }
    validated.time_range = args.time_range;
  }

  if (args.safesearch !== undefined) {
    const safesearch = Number(args.safesearch);
    if (!Number.isInteger(safesearch) || safesearch < 0 || safesearch > 2) {
      throw new Error('safesearch must be an integer between 0 and 2');
    }
    validated.safesearch = safesearch;
  }

  if (args.max_results !== undefined) {
    const maxResults = Number(args.max_results);
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50) {
      throw new Error('max_results must be an integer between 1 and 50');
    }
    validated.max_results = maxResults;
  }

  return validated;
}

async function handler({
  query,
  categories,
  engines,
  language,
  pageno,
  time_range,
  safesearch,
  max_results = 10,
}) {
  const searxngUrl = process.env.SEARXNG_BASE_URL;
  if (!searxngUrl) {
    throw new Error('SEARXNG_BASE_URL environment variable is not set');
  }
  // Basic URL sanity check to provide clearer errors for bad config
  try {
    const parsed = new URL(searxngUrl);
    if (!parsed.protocol || !/^https?:$/.test(parsed.protocol)) {
      throw new Error('SEARXNG_BASE_URL must start with http:// or https://');
    }
  } catch (e) {
    throw new Error(`Invalid SEARXNG_BASE_URL: ${e.message || String(e)}`);
  }

  // Build URL with query parameters
  const url = new URL('/search', searxngUrl);
  const params = new URLSearchParams({
    q: query,
    format: 'json',
  });

  if (categories !== undefined) params.append('categories', categories);
  if (engines !== undefined) params.append('engines', engines);
  if (language !== undefined) params.append('language', language);
  if (pageno !== undefined) params.append('pageno', pageno.toString());
  if (time_range !== undefined) params.append('time_range', time_range);
  if (safesearch !== undefined) params.append('safesearch', safesearch.toString());

  url.search = params.toString();

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let apiErrorMessage = '';

      // Parse error details if available
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

      // 404 - Endpoint not found
      if (response.status === 404) {
        throw new Error(`SearXNG API endpoint not found. Please check SEARXNG_BASE_URL configuration: ${searxngUrl}`);
      }

      // 500+ - Server errors
      if (response.status >= 500) {
        throw new Error(`SearXNG service error (${response.status}): ${apiErrorMessage} (Please try again later)`);
      }

      // Other errors - provide full context
      throw new Error(`SearXNG API request failed with status ${response.status}: ${apiErrorMessage}`);
    }

    const results = await response.json();
    let output = '';

    // Add query info
    output += `Query: ${results.query || query}\n`;
    if (results.number_of_results !== undefined) {
      output += `Number of results: ${results.number_of_results}\n`;
    }
    output += '\n';

    // Process search results
    if (Array.isArray(results.results) && results.results.length > 0) {
      const limitedResults = results.results.slice(0, max_results);

      output += 'Search Results:\n\n';
      limitedResults.forEach((result, index) => {
        const title = result?.title || 'Untitled';
        const snippet = typeof result?.content === 'string'
          ? (result.content.length > 800 ? `${result.content.slice(0, 800).trim()}…` : result.content)
          : undefined;
        const urlStr = typeof result?.url === 'string' ? result.url : 'N/A';
        const source = result?.engine;
        const published = result?.publishedDate || result?.published || result?.date;

        output += `${index + 1}. ${title}\n`;
        if (snippet) {
          output += `   ${snippet}\n`;
        }
        output += `   URL: ${urlStr}\n`;
        if (source) {
          output += `   Source: ${source}\n`;
        }
        if (published) {
          output += `   Published: ${published}\n`;
        }

        output += '\n';
      });

      if (results.results.length > max_results) {
        output += `... and ${results.results.length - max_results} more results\n`;
      }
    } else {
      output += 'No results found.\n';
    }

    // Add suggestions if available
    if (Array.isArray(results.suggestions) && results.suggestions.length > 0) {
      output += '\nSuggestions:\n';
      results.suggestions.forEach((suggestion, index) => {
        output += `${index + 1}. ${suggestion}\n`;
      });
    }

    // Add corrections if available
    if (Array.isArray(results.corrections) && results.corrections.length > 0) {
      output += '\nDid you mean:\n';
      results.corrections.forEach((correction, index) => {
        output += `${index + 1}. ${correction}\n`;
      });
    }

    // Add infoboxes if available
    if (Array.isArray(results.infoboxes) && results.infoboxes.length > 0) {
      output += '\nAdditional Information:\n';
      results.infoboxes.forEach((infobox, index) => {
        if (infobox?.infobox) {
          output += `\n${index + 1}. ${infobox.infobox}\n`;
          if (infobox.content) {
            const info = typeof infobox.content === 'string' && infobox.content.length > 800
              ? `${infobox.content.slice(0, 800).trim()}…`
              : infobox.content;
            if (info) output += `   ${info}\n`;
          }
          if (Array.isArray(infobox.urls) && infobox.urls.length > 0) {
            output += `   URLs: ${infobox.urls.join(', ')}\n`;
          }
        }
      });
    }

    return output.trim();
  } catch (error) {
    logger.error('Error performing web search with SearXNG:', {
      error: error?.message || String(error),
      query,
      categories,
      engines,
      language
    });

    // Handle timeout errors
    if (error.name === 'AbortError') {
      throw new Error('Request timeout: SearXNG took too long to respond (30s timeout)');
    }

    // Re-throw with more context if it's a generic error
    if (error.message && !error.message.includes('SearXNG')) {
      // Network or fetch errors
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error(`Network error while connecting to SearXNG: ${error.message}. Please check SEARXNG_BASE_URL: ${searxngUrl}`);
      }
      // JSON parsing errors
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid response from SearXNG: ${error.message}`);
      }
      // Generic wrapper for unknown errors
      throw new Error(`Web search failed: ${error.message}`);
    }

    // Re-throw existing error if it already has good context
    throw error;
  }
}

export const webSearchSearxngTool = createTool({
  name: TOOL_NAME,
  description: 'Privacy-focused metasearch engine aggregating results from multiple sources. Best for privacy-conscious searches, accessing diverse search engines, and avoiding tracking. Self-hosted and highly configurable.',
  validate,
  handler,
  openAI: {
    type: 'function',
    function: {
      name: TOOL_NAME,
      description: 'Privacy-focused metasearch engine that aggregates results from multiple sources (Google, Bing, DuckDuckGo, Wikipedia, etc.) without tracking. Self-hosted solution ideal for privacy-conscious searches, accessing diverse search engines simultaneously, and custom search configurations. Requires SEARXNG_BASE_URL to be configured.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to execute',
          },
          categories: {
            type: 'string',
            description: 'Comma-separated list of search categories (e.g., "general", "images", "videos", "news", "music", "files", "it", "science", "map"). Default is "general".',
          },
          engines: {
            type: 'string',
            description: 'Comma-separated list of specific search engines to use (e.g., "google,duckduckgo,wikipedia"). Restricts search to only these engines.',
          },
          language: {
            type: 'string',
            description: 'Language code for search results (e.g., "en", "fr", "de", "es"). Default is "all".',
          },
          pageno: {
            type: 'integer',
            description: 'Page number for pagination (default: 1). Each page typically returns 10-20 results depending on engines.',
            minimum: 1,
          },
          time_range: {
            type: 'string',
            enum: ['day', 'week', 'month', 'year'],
            description: 'Filter results by time range. Useful for finding recent content.',
          },
          safesearch: {
            type: 'integer',
            description: 'Safe search level: 0 (none), 1 (moderate), 2 (strict). Default is 0.',
            minimum: 0,
            maximum: 2,
          },
          max_results: {
            type: 'integer',
            description: 'Maximum number of search results to display (default: 10, max: 50). Note: SearXNG may return fewer results depending on available engines.',
            minimum: 1,
            maximum: 50,
          },
        },
        required: ['query'],
      },
    },
  },
});

export default webSearchSearxngTool;
