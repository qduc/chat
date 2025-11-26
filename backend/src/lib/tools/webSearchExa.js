import { createTool } from './baseTool.js';
import { logger } from '../../logger.js';
import { getUserSetting } from '../../db/userSettings.js';

const TOOL_NAME = 'web_search_exa';
const VALID_TYPES = ['auto', 'keyword', 'neural'];

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
    if (!Number.isInteger(numResults) || numResults < 1 || numResults > 100) {
      throw new Error('num_results must be an integer between 1 and 100');
    }
    validated.num_results = numResults;
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

  // Validate text parameter (boolean or object)
  if (args.text !== undefined) {
    if (typeof args.text === 'boolean') {
      validated.text = args.text;
    } else if (typeof args.text === 'object' && args.text !== null) {
      validated.text = {};
      if (args.text.max_characters !== undefined) {
        const maxChars = Number(args.text.max_characters);
        if (!Number.isInteger(maxChars) || maxChars < 1) {
          throw new Error('text.max_characters must be a positive integer');
        }
        validated.text.maxCharacters = maxChars;
      }
      if (args.text.include_html_tags !== undefined) {
        validated.text.includeHtmlTags = Boolean(args.text.include_html_tags);
      }
    } else {
      throw new Error('text must be a boolean or an object with optional max_characters and include_html_tags');
    }
  }

  // Validate highlights parameter (boolean or object)
  if (args.highlights !== undefined) {
    if (typeof args.highlights === 'boolean') {
      validated.highlights = args.highlights;
    } else if (typeof args.highlights === 'object' && args.highlights !== null) {
      validated.highlights = {};
      if (args.highlights.query !== undefined) {
        if (typeof args.highlights.query !== 'string' || args.highlights.query.trim().length === 0) {
          throw new Error('highlights.query must be a non-empty string');
        }
        validated.highlights.query = args.highlights.query.trim();
      }
      if (args.highlights.num_sentences !== undefined) {
        const numSentences = Number(args.highlights.num_sentences);
        if (!Number.isInteger(numSentences) || numSentences < 1) {
          throw new Error('highlights.num_sentences must be a positive integer');
        }
        validated.highlights.numSentences = numSentences;
      }
      if (args.highlights.highlights_per_url !== undefined) {
        const highlightsPerUrl = Number(args.highlights.highlights_per_url);
        if (!Number.isInteger(highlightsPerUrl) || highlightsPerUrl < 1) {
          throw new Error('highlights.highlights_per_url must be a positive integer');
        }
        validated.highlights.highlightsPerUrl = highlightsPerUrl;
      }
    } else {
      throw new Error('highlights must be a boolean or an object with optional query, num_sentences, and highlights_per_url');
    }
  }

  // Validate summary parameter (boolean or object)
  if (args.summary !== undefined) {
    if (typeof args.summary === 'boolean') {
      validated.summary = args.summary;
    } else if (typeof args.summary === 'object' && args.summary !== null) {
      validated.summary = {};
      if (args.summary.query !== undefined) {
        if (typeof args.summary.query !== 'string' || args.summary.query.trim().length === 0) {
          throw new Error('summary.query must be a non-empty string');
        }
        validated.summary.query = args.summary.query.trim();
      }
    } else {
      throw new Error('summary must be a boolean or an object with optional query');
    }
  }

  return validated;
}

function formatResultContent(result) {
  if (!result) return '';

  let content = '';

  // Add text content (formatted as markdown by default in Exa API)
  if (typeof result.text === 'string' && result.text.trim()) {
    content += `   Text: ${result.text.trim()}\n`;
  }

  // Add highlights (array of strings)
  if (Array.isArray(result.highlights) && result.highlights.length > 0) {
    content += `   Highlights:\n`;
    result.highlights.forEach((highlight, idx) => {
      content += `     ${idx + 1}. ${highlight.trim()}\n`;
    });
  }

  // Add summary (string)
  if (typeof result.summary === 'string' && result.summary.trim()) {
    content += `   Summary: ${result.summary.trim()}\n`;
  }

  return content;
}

async function handler({
  query,
  type,
  num_results,
  include_domains,
  exclude_domains,
  text,
  highlights,
  summary,
}, context = {}) {
  const userId = context?.userId || null;
  let apiKey = null;
  if (userId) {
    try {
      // Use per-tool key name for Exa
      const row = getUserSetting(userId, 'exa_api_key');
      if (row && row.value) apiKey = row.value;
    } catch (err) {
      logger.warn('Failed to read user exa_api_key from DB', { userId, err: err?.message || err });
    }
  }
  if (!apiKey) {
    throw new Error('Exa API key is not configured. Please add it in Settings → Search & Web Tools.');
  }

  const url = 'https://api.exa.ai/search';

  const requestBody = {
    query,
  };

  if (type !== undefined) requestBody.type = type;
  if (num_results !== undefined) requestBody.numResults = num_results;
  if (include_domains !== undefined) requestBody.includeDomains = include_domains;
  if (exclude_domains !== undefined) requestBody.excludeDomains = exclude_domains;

  // Content retrieval - must be nested inside 'contents' object
  const hasContentRequest = text !== undefined || highlights !== undefined || summary !== undefined;

  if (hasContentRequest) {
    requestBody.contents = {};
    if (text !== undefined) requestBody.contents.text = text;
    if (highlights !== undefined) requestBody.contents.highlights = highlights;
    if (summary !== undefined) requestBody.contents.summary = summary;
  } else {
    // If no content was requested, default to highlights for better results
    requestBody.contents = { highlights: true };
  }

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
        throw new Error(
          `Invalid Exa request parameters: ${apiErrorMessage}. Please adjust the tool call parameters and try again.`
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Exa API authentication failed: ${apiErrorMessage} (Verify your Exa API key under Settings → Search & Web Tools)`
        );
      }

      if (response.status === 429) {
        throw new Error(
          `Exa API rate limit exceeded: ${apiErrorMessage} (API quota exhausted - please try again later)`
        );
      }

      if (response.status >= 500) {
        throw new Error(`Exa service error (${response.status}): ${apiErrorMessage} (Please try again later)`);
      }

      throw new Error(`Exa API request failed with status ${response.status}: ${apiErrorMessage}`);
    }

    const results = await response.json();
    let output = '';

    if (Array.isArray(results.results) && results.results.length > 0) {
      output += 'Search Results:\n\n';
      results.results.forEach((result, index) => {
        const title = result.title || result.url || `Result ${index + 1}`;
        output += `${index + 1}. ${title}\n`;

        // Extract and display content
        const content = formatResultContent(result);
        if (content) {
          output += content;
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
        output += '\n'; // Add spacing between results
      });
    }

    return output.trim() || 'No results found.';
  } catch (error) {
    logger.error('Error performing web search with Exa:', error);

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
  description: 'Deep research with semantic search and custom content extraction. Best for technical queries, detailed specs, and when you need precise excerpts or AI summaries. Returns highlights by default.',
  validate,
  handler,
  openAI: {
    type: 'function',
    function: {
      name: TOOL_NAME,
      description: 'Deep research tool with semantic/neural search. Best for technical deep-dives, detailed specs, benchmarks, and when you need custom highlight extraction or per-result AI summaries. Use type="neural" for semantic understanding. Returns highlights by default.',
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
            maximum: 100,
            description: 'Maximum number of results to return (1-100). Neural search supports up to 100, keyword search up to 10. Defaults to 10.',
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
          text: {
            oneOf: [
              { type: 'boolean' },
              {
                type: 'object',
                properties: {
                  max_characters: {
                    type: 'integer',
                    minimum: 1,
                    description: 'Maximum number of characters to return per result.',
                  },
                  include_html_tags: {
                    type: 'boolean',
                    description: 'If true, returns HTML. If false (default), returns clean markdown.',
                  },
                },
                additionalProperties: false,
              },
            ],
            description: 'Retrieve full text content from each result. Pass true for default text, or an object to configure max_characters and include_html_tags. Text is returned as markdown by default.',
          },
          highlights: {
            oneOf: [
              { type: 'boolean' },
              {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'Specific query to use for generating highlights (if different from search query).',
                  },
                  num_sentences: {
                    type: 'integer',
                    minimum: 1,
                    description: 'Number of sentences per highlight.',
                  },
                  highlights_per_url: {
                    type: 'integer',
                    minimum: 1,
                    description: 'Maximum number of highlights to return per URL.',
                  },
                },
                additionalProperties: false,
              },
            ],
            description: 'Retrieve key excerpts most relevant to your query. Pass true for defaults, or an object to configure query, num_sentences, and highlights_per_url.',
          },
          summary: {
            oneOf: [
              { type: 'boolean' },
              {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'Specific query to guide the summary generation.',
                  },
                },
                additionalProperties: false,
              },
            ],
            description: 'Generate AI-powered summaries of each result. Pass true for default summary, or an object with a query to guide summarization.',
          },
        },
        required: ['query'],
      },
    },
  },
});

export default webSearchExaTool;
