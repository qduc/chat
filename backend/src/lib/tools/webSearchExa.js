import { createTool } from './baseTool.js';

const TOOL_NAME = 'web_search_exa';
const VALID_TYPES = ['auto', 'keyword', 'neural'];
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function validate(args) {
  if (!args || typeof args.query !== 'string' || args.query.trim().length === 0) {
    throw new Error('web_search_exa requires a "query" argument of type string');
  }

  const validated = { query: args.query.trim() };

  if (args.type !== undefined) {
    const type = String(args.type).toLowerCase();
    if (!VALID_TYPES.includes(type)) {
      throw new Error('type must be one of: "auto", "keyword", "neural"');
    }
    validated.type = type;
  }

  if (args.num_results !== undefined) {
    const numResults = Number(args.num_results);
    if (!Number.isInteger(numResults) || numResults < 1 || numResults > 20) {
      throw new Error('num_results must be an integer between 1 and 20');
    }
    validated.num_results = numResults;
  }

  if (args.page !== undefined) {
    const page = Number(args.page);
    if (!Number.isInteger(page) || page < 1) {
      throw new Error('page must be a positive integer');
    }
    validated.page = page;
  }

  if (args.use_autoprompt !== undefined) {
    validated.use_autoprompt = Boolean(args.use_autoprompt);
  }

  if (args.include_domains !== undefined) {
    if (!Array.isArray(args.include_domains) || !args.include_domains.every((domain) => typeof domain === 'string' && domain.trim().length > 0)) {
      throw new Error('include_domains must be an array of non-empty strings');
    }
    validated.include_domains = args.include_domains.map((domain) => domain.trim());
  }

  if (args.exclude_domains !== undefined) {
    if (!Array.isArray(args.exclude_domains) || !args.exclude_domains.every((domain) => typeof domain === 'string' && domain.trim().length > 0)) {
      throw new Error('exclude_domains must be an array of non-empty strings');
    }
    validated.exclude_domains = args.exclude_domains.map((domain) => domain.trim());
  }

  if (args.start_published_date !== undefined) {
    if (typeof args.start_published_date !== 'string' || !DATE_REGEX.test(args.start_published_date)) {
      throw new Error('start_published_date must be in YYYY-MM-DD format');
    }
    validated.start_published_date = args.start_published_date;
  }

  if (args.end_published_date !== undefined) {
    if (typeof args.end_published_date !== 'string' || !DATE_REGEX.test(args.end_published_date)) {
      throw new Error('end_published_date must be in YYYY-MM-DD format');
    }
    validated.end_published_date = args.end_published_date;
  }

  return validated;
}

function extractSnippet(result) {
  if (!result) return undefined;

  if (typeof result.highlight === 'string') {
    return result.highlight;
  }

  if (Array.isArray(result.highlight)) {
    return result.highlight.join(' ');
  }

  if (Array.isArray(result.highlights)) {
    return result.highlights.join(' ');
  }

  if (typeof result.summary === 'string') {
    return result.summary;
  }

  if (result.summary && typeof result.summary.text === 'string') {
    return result.summary.text;
  }

  if (typeof result.snippet === 'string') {
    return result.snippet;
  }

  if (typeof result.text === 'string') {
    return result.text;
  }

  return undefined;
}

function extractSummary(data) {
  if (!data || typeof data !== 'object') return undefined;

  if (typeof data.summary === 'string') {
    return data.summary;
  }

  if (data.summary && typeof data.summary === 'object') {
    if (typeof data.summary.text === 'string') {
      return data.summary.text;
    }
    if (Array.isArray(data.summary.highlights)) {
      return data.summary.highlights.join(' ');
    }
  }

  if (Array.isArray(data.highlights)) {
    return data.highlights.join(' ');
  }

  return undefined;
}

async function handler({
  query,
  type,
  num_results,
  page,
  use_autoprompt,
  include_domains,
  exclude_domains,
  start_published_date,
  end_published_date,
}) {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new Error('EXA_API_KEY environment variable is not set');
  }

  const url = 'https://api.exa.ai/search';

  const requestBody = {
    query,
  };

  if (type !== undefined) requestBody.type = type;
  if (num_results !== undefined) requestBody.numResults = num_results;
  if (page !== undefined) requestBody.page = page;
  if (use_autoprompt !== undefined) requestBody.useAutoprompt = use_autoprompt;
  if (include_domains !== undefined) requestBody.includeDomains = include_domains;
  if (exclude_domains !== undefined) requestBody.excludeDomains = exclude_domains;
  if (start_published_date !== undefined) requestBody.startPublishedDate = start_published_date;
  if (end_published_date !== undefined) requestBody.endPublishedDate = end_published_date;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
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

      if (response.status === 400) {
        throw new Error(`Invalid Exa request parameters: ${apiErrorMessage}. Please adjust the tool call parameters and try again.`);
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error(`Exa API authentication failed: ${apiErrorMessage} (Check EXA_API_KEY configuration)`);
      }

      if (response.status === 429) {
        throw new Error(`Exa API rate limit exceeded: ${apiErrorMessage} (API quota exhausted - please try again later)`);
      }

      if (response.status >= 500) {
        throw new Error(`Exa service error (${response.status}): ${apiErrorMessage} (Please try again later)`);
      }

      throw new Error(`Exa API request failed with status ${response.status}: ${apiErrorMessage}`);
    }

    const results = await response.json();
    let output = '';

    const summaryText = extractSummary(results);
    if (summaryText) {
      output += `Summary: ${summaryText.trim()}\n\n`;
    }

    if (Array.isArray(results.results) && results.results.length > 0) {
      output += 'Search Results:\n';
      results.results.forEach((result, index) => {
        const title = result.title || result.url || `Result ${index + 1}`;
        output += `${index + 1}. ${title}\n`;
        const snippet = extractSnippet(result);
        if (snippet) {
          output += `   Snippet: ${snippet.trim()}\n`;
        }
        if (result.publishedDate) {
          output += `   Published: ${result.publishedDate}\n`;
        }
        if (typeof result.score === 'number') {
          output += `   Relevance Score: ${result.score}\n`;
        }
        if (result.url) {
          output += `   URL: ${result.url}\n`;
        }
      });
    }

    return output.trim() || 'No results found.';
  } catch (error) {
    console.error('Error performing web search with Exa:', error);

    if (error.message && !error.message.includes('Exa')) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error(`Network error while connecting to Exa API: ${error.message}`);
      }

      if (error instanceof SyntaxError) {
        throw new Error(`Invalid response from Exa API: ${error.message}`);
      }

      throw new Error(`Exa web search failed: ${error.message}`);
    }

    throw error;
  }
}

export const webSearchExaTool = createTool({
  name: TOOL_NAME,
  description: 'Perform a web search using Exa API for high-quality, up-to-date results with control over domains and date ranges.',
  validate,
  handler,
  openAI: {
    type: 'function',
    function: {
      name: TOOL_NAME,
      description: 'Search the web using the Exa API to retrieve high-quality, current sources. Only specify optional parameters when you need to narrow or customize the search.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to execute. Should describe the information need clearly.',
          },
          type: {
            type: 'string',
            enum: VALID_TYPES,
            description: 'Search algorithm to use. "auto" lets Exa choose, "neural" prioritizes semantic relevance, "keyword" favors lexical matches.',
          },
          num_results: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'Maximum number of results to return (1-20). Defaults to Exa standard (typically 10).',
          },
          page: {
            type: 'integer',
            minimum: 1,
            description: 'Results page to retrieve when paginating beyond the first page. Defaults to 1.',
          },
          use_autoprompt: {
            type: 'boolean',
            description: 'Enable Exa autoprompting to automatically expand or refine search queries.',
          },
          include_domains: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of domains to include in the results (e.g. ["arxiv.org", "nytimes.com"]).',
          },
          exclude_domains: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of domains to exclude from the results.',
          },
          start_published_date: {
            type: 'string',
            pattern: '^\\d{4}-\\d{2}-\\d{2}$',
            description: 'Earliest publication date to include (YYYY-MM-DD).',
          },
          end_published_date: {
            type: 'string',
            pattern: '^\\d{4}-\\d{2}-\\d{2}$',
            description: 'Latest publication date to include (YYYY-MM-DD).',
          },
        },
        required: ['query'],
      },
    },
  },
});

export default webSearchExaTool;
