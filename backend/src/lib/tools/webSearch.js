import { createTool } from './baseTool.js';
import { logger } from '../../logger.js';

const TOOL_NAME = 'web_search';

function validate(args) {
  if (!args || typeof args.query !== 'string' || args.query.trim().length === 0) {
    throw new Error('web_search requires a "query" argument of type string');
  }

  const validated = { query: args.query.trim() };

  // Optional parameters with validation
  if (args.search_depth !== undefined) {
    if (!['basic', 'advanced'].includes(args.search_depth)) {
      throw new Error('search_depth must be either "basic" or "advanced"');
    }
    validated.search_depth = args.search_depth;
  }

  if (args.topic !== undefined) {
    if (!['general', 'news', 'finance'].includes(args.topic)) {
      throw new Error('topic must be one of: "general", "news", "finance"');
    }
    validated.topic = args.topic;
  }

  if (args.days !== undefined) {
    const days = Number(args.days);
    if (!Number.isInteger(days) || days < 1) {
      throw new Error('days must be a positive integer');
    }
    validated.days = days;
  }

  if (args.max_results !== undefined) {
    const maxResults = Number(args.max_results);
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 20) {
      throw new Error('max_results must be an integer between 1 and 20');
    }
    validated.max_results = maxResults;
  }

  if (args.include_answer !== undefined) {
    if (typeof args.include_answer === 'boolean') {
      validated.include_answer = args.include_answer ? 'basic' : false;
    } else if (['basic', 'advanced'].includes(args.include_answer)) {
      validated.include_answer = args.include_answer;
    } else {
      throw new Error('include_answer must be a boolean or one of: "basic", "advanced"');
    }
  }

  if (args.include_raw_content !== undefined) {
    if (typeof args.include_raw_content === 'boolean') {
      validated.include_raw_content = args.include_raw_content;
    } else if (['markdown', 'text'].includes(args.include_raw_content)) {
      validated.include_raw_content = args.include_raw_content;
    } else {
      throw new Error('include_raw_content must be a boolean or one of: "markdown", "text"');
    }
  }

  if (args.include_images !== undefined) {
    validated.include_images = Boolean(args.include_images);
  }

  if (args.include_image_descriptions !== undefined) {
    validated.include_image_descriptions = Boolean(args.include_image_descriptions);
  }

  if (args.include_domains !== undefined) {
    if (!Array.isArray(args.include_domains)) {
      throw new Error('include_domains must be an array of domain strings');
    }
    validated.include_domains = args.include_domains;
  }

  if (args.exclude_domains !== undefined) {
    if (!Array.isArray(args.exclude_domains)) {
      throw new Error('exclude_domains must be an array of domain strings');
    }
    validated.exclude_domains = args.exclude_domains;
  }

  if (args.time_range !== undefined) {
    if (!['day', 'week', 'month', 'year', 'd', 'w', 'm', 'y'].includes(args.time_range)) {
      throw new Error('time_range must be one of: "day", "week", "month", "year", "d", "w", "m", "y"');
    }
    validated.time_range = args.time_range;
  }

  if (args.start_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.start_date)) {
      throw new Error('start_date must be in YYYY-MM-DD format');
    }
    validated.start_date = args.start_date;
  }

  if (args.end_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.end_date)) {
      throw new Error('end_date must be in YYYY-MM-DD format');
    }
    validated.end_date = args.end_date;
  }

  return validated;
}

async function handler({
  query,
  search_depth,
  topic,
  days,
  max_results,
  include_answer,
  include_raw_content,
  include_images,
  include_image_descriptions,
  include_domains,
  exclude_domains,
  time_range,
  start_date,
  end_date
}) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY environment variable is not set');
  }

  const url = 'https://api.tavily.com/search';

  // Build request body with only specified parameters
  const requestBody = {
    api_key: apiKey,
    query,
  };

  if (search_depth !== undefined) requestBody.search_depth = search_depth;
  if (topic !== undefined) requestBody.topic = topic;
  if (days !== undefined) requestBody.days = days;
  if (max_results !== undefined) requestBody.max_results = max_results;
  if (include_answer !== undefined) requestBody.include_answer = include_answer;
  if (include_raw_content !== undefined) requestBody.include_raw_content = include_raw_content;
  if (include_images !== undefined) requestBody.include_images = include_images;
  if (include_image_descriptions !== undefined) requestBody.include_image_descriptions = include_image_descriptions;
  if (include_domains !== undefined) requestBody.include_domains = include_domains;
  if (exclude_domains !== undefined) requestBody.exclude_domains = exclude_domains;
  if (time_range !== undefined) requestBody.time_range = time_range;
  if (start_date !== undefined) requestBody.start_date = start_date;
  if (end_date !== undefined) requestBody.end_date = end_date;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
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

      // 401/403 - Authentication/authorization issues (infra)
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Tavily API authentication failed: ${apiErrorMessage} (Check TAVILY_API_KEY configuration)`);
      }

      // 429 - Rate limiting (infra)
      if (response.status === 429) {
        throw new Error(`Tavily API rate limit exceeded: ${apiErrorMessage} (API quota exhausted - please try again later)`);
      }

      // 500+ - Server errors (infra)
      if (response.status >= 500) {
        throw new Error(`Tavily service error (${response.status}): ${apiErrorMessage} (Please try again later)`);
      }

      // Other errors - provide full context
      throw new Error(`Tavily API request failed with status ${response.status}: ${apiErrorMessage}`);
    } const results = await response.json();
    let output = '';

    if (results.answer) {
      output += `Answer: ${results.answer}\n\n`;
    }

    if (results.images && Array.isArray(results.images) && results.images.length > 0) {
      output += 'Images:\n';
      results.images.forEach((img, index) => {
        if (typeof img === 'string') {
          output += `${index + 1}. ${img}\n`;
        } else if (img.url) {
          output += `${index + 1}. ${img.url}`;
          if (img.description) output += ` - ${img.description}`;
          output += '\n';
        }
      });
      output += '\n';
    }

    if (Array.isArray(results.results) && results.results.length > 0) {
      output += 'Search Results:\n';
      results.results.forEach((result, index) => {
        output += `${index + 1}. ${result.title}\n`;
        if (result.content) output += `   Content: ${result.content}\n`;
        if (result.raw_content && include_raw_content) output += `   Raw Content: ${result.raw_content}\n`;
        output += `   URL: ${result.url}\n`;
        if (result.score !== undefined) output += `   Relevance Score: ${result.score}\n`;
      });
    }

    return output.trim() || 'No results found.';
  } catch (error) {
    logger.error('Error performing web search with Tavily:', error);

    // Re-throw with more context if it's a generic error
    if (error.message && !error.message.includes('Tavily')) {
      // Network or fetch errors
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error(`Network error while connecting to Tavily API: ${error.message}`);
      }
      // JSON parsing errors
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid response from Tavily API: ${error.message}`);
      }
      // Generic wrapper for unknown errors
      throw new Error(`Web search failed: ${error.message}`);
    }

    // Re-throw existing error if it already has good context
    throw error;
  }
}

export const webSearchTool = createTool({
  name: TOOL_NAME,
  description: 'Fast, high-quality search with excellent default relevance. Best for quick answers, news/current events, and general queries. Optionally includes AI-generated answers.',
  validate,
  handler,
  openAI: {
    type: 'function',
    function: {
      name: TOOL_NAME,
      description: 'Fast, accurate search with excellent out-of-the-box relevance. Best for quick answers, news/current events, and broad queries. Superior for time-sensitive topics with optional AI-generated summaries (include_answer). Defaults work great—only customize when needed.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to execute',
          },
          search_depth: {
            type: 'string',
            enum: ['basic', 'advanced'],
            description: 'The depth of the search. "basic" provides generic content snippets (default, 1 credit). "advanced" retrieves the most relevant sources with better content snippets (2 credits, higher quality results).',
          },
          days: {
            type: 'integer',
            description: 'Number of days back from current date to include results (publish date). Only works with topic="news". Default is 7 days.',
            minimum: 1,
          },
          time_range: {
            type: 'string',
            enum: ['day', 'week', 'month', 'year', 'd', 'w', 'm', 'y'],
            description: 'Time range back from current date to filter results by publish date. Accepts "day", "week", "month", "year" or shorthand "d", "w", "m", "y".',
          },
          max_results: {
            type: 'integer',
            description: 'Maximum number of search results to return. Must be between 1 and 20. Default is 5.',
            minimum: 1,
            maximum: 20,
          },
          include_answer: {
            type: 'string',
            enum: ['basic', 'advanced'],
            description: 'Include an AI-generated answer to the query based on search results. "basic" provides a quick answer, "advanced" provides a detailed answer (costs more). Omit or set to false to skip answer generation.',
          },
          include_domains: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of domains to specifically include in search results (e.g., ["wikipedia.org", "github.com"]). Only results from these domains will be returned.',
          },
          exclude_domains: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of domains to exclude from search results (e.g., ["example.com", "spam.com"]). Results from these domains will be filtered out.',
          },
        },
        required: ['query'],
      },
    },
  },
});

export default webSearchTool;
