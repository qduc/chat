import { createTool } from './baseTool.js';
import { fetchWebPage } from '@qduc/web-fetch';
import { browserService } from '../browser/BrowserService.js';

const TOOL_NAME = 'web_fetch';

// Maximum output length to prevent token overflow
const DEFAULT_MAX_CHARS = 10000; // Increased from 5000 for better context
const MAX_CHARS_LIMIT = 200000; // Hard limit: ~50,000 tokens

// Maximum body size to prevent memory issues (10 MB)
const MAX_BODY_SIZE = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; ChatForge/1.0; +https://chatforge.app)';

function validate(args) {
  if (!args || typeof args !== 'object') {
    throw new Error('web_fetch requires an arguments object');
  }

  const { url, max_chars, continuation_token, use_browser } = args;

  // If continuation_token is provided, we're fetching next chunk
  if (continuation_token) {
    if (typeof continuation_token !== 'string') {
      throw new Error('continuation_token must be a string');
    }

    // Validate max_chars for continuation
    let maxChars = DEFAULT_MAX_CHARS;
    if (max_chars !== undefined) {
      if (typeof max_chars !== 'number' || max_chars < 200) {
        throw new Error('max_chars must be a number >= 200');
      }
      if (max_chars > MAX_CHARS_LIMIT) {
        throw new Error(`max_chars cannot exceed ${MAX_CHARS_LIMIT}`);
      }
      maxChars = max_chars;
    }

    return { continuation_token, maxChars };
  }

  // Normal fetch - require URL
  if (!url || typeof url !== 'string') {
    throw new Error('web_fetch requires a valid "url" string parameter');
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid URL format: ${url}`);
  }

  // Validate max_chars if provided
  let maxChars = DEFAULT_MAX_CHARS;
  if (max_chars !== undefined) {
    if (typeof max_chars !== 'number' || max_chars < 200) {
      throw new Error('max_chars must be a number >= 200');
    }
    if (max_chars > MAX_CHARS_LIMIT) {
      throw new Error(`max_chars cannot exceed ${MAX_CHARS_LIMIT}`);
    }
    maxChars = max_chars;
  }

  // Validate headings if provided
  let targetHeadings = null;
  const { heading } = args;
  if (heading !== undefined && heading !== null) {
    if (Array.isArray(heading)) {
      targetHeadings = heading
        .map(h => {
          if (typeof h === 'string') return h.trim();
          if (typeof h === 'number') return h;
          return null;
        })
        .filter(h => h !== null && (typeof h !== 'string' || h.length > 0));
      if (targetHeadings.length === 0) targetHeadings = null;
    } else if (typeof heading === 'string') {
      const trimmed = heading.trim();
      targetHeadings = trimmed.length > 0 ? [trimmed] : null;
    } else if (typeof heading === 'number') {
      targetHeadings = [heading];
    } else {
      throw new Error('heading must be a string, number, or an array of strings/numbers');
    }
  }

  // Validate use_browser if provided
  let useBrowser = false;
  if (use_browser !== undefined) {
    if (typeof use_browser !== 'boolean') {
      throw new Error('use_browser must be a boolean');
    }
    useBrowser = use_browser;
  }

  return { url, maxChars, targetHeadings, useBrowser };
}

function createBrowserFetchImpl() {
  return async (input) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    const options = {};
    if (url.includes('stackoverflow.com')) {
      options.waitSelector = '#question-header';
    }

    const html = await browserService.fetchPageContent(url, options);

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (name) => (name && name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null),
      },
      text: async () => html,
    };
  };
}

function formatResult(result) {
  const tocBlock = result.toc ? `## Table of Contents\n\n${result.toc}\n\n---\n\n` : '';
  const markdown = tocBlock ? `${tocBlock}${result.markdown}` : result.markdown;

  return {
    url: result.url,
    title: result.title || 'Untitled',
    markdown,
    length: markdown.length,
    extractionMethod: result.method,
    truncated: Boolean(result.continuationToken),
    ...(result.toc && { tableOfContents: result.toc }),
    ...(result.continuationToken && { continuation_token: result.continuationToken }),
  };
}

async function handler({ url, maxChars, targetHeadings, continuation_token, useBrowser }) {
  const commonOptions = {
    maxChars,
    headings: targetHeadings || undefined,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    userAgent: DEFAULT_USER_AGENT,
    maxBodySizeBytes: MAX_BODY_SIZE,
  };

  try {
    if (continuation_token) {
      const result = await fetchWebPage({
        continuationToken: continuation_token,
        maxChars,
      });
      return formatResult(result);
    }

    if (useBrowser) {
      const result = await fetchWebPage({
        ...commonOptions,
        url,
        fetchImpl: createBrowserFetchImpl(),
      });
      return formatResult(result);
    }

    try {
      const result = await fetchWebPage({
        ...commonOptions,
        url,
      });
      return formatResult(result);
    } catch (error) {
      const browserResult = await fetchWebPage({
        ...commonOptions,
        url,
        fetchImpl: createBrowserFetchImpl(),
      });
      return formatResult(browserResult);
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Request timeout: The page took too long to load');
    }
    throw new Error(`Failed to fetch URL: ${error.message}`);
  }
}

export const webFetchTool = createTool({
  name: TOOL_NAME,
  description: 'Fetch a web page and convert its HTML content to Markdown format with intelligent content navigation',
  validate,
  handler,
  openAI: {
    type: 'function',
    function: {
      name: TOOL_NAME,
      description:
        'Fetch a web page and convert its HTML content to Markdown format. Returns the page title and content as markdown. Automatically detects headings (h1-h3) and includes a table of contents.\n\nNavigation strategies:\n1. For structured content with headings: Use heading or heading_range to get specific sections\n2. For unstructured content: Use continuation_token to fetch subsequent chunks\n3. For JavaScript-heavy or SPA sites: Use use_browser: true to ensure content is fully rendered before extraction\n\nThe tool automatically chooses the best strategy based on content structure.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL of the web page to fetch (required for initial fetch, omit when using continuation_token)',
          },
          max_chars: {
            type: 'number',
            description: `Maximum number of characters to return per chunk (default: ${DEFAULT_MAX_CHARS}). Content will be intelligently truncated at paragraph/sentence boundaries.`,
          },
          heading: {
            type: 'array',
            items: {
              anyOf: [
                { type: 'string' },
                { type: 'number' }
              ]
            },
            description: 'Optional: Array of headings (h1-h3) to retrieve content from. Can be heading names (strings, partial match) or indices (numbers, 1st heading is 1). Content includes subheadings until a same or higher-level heading is reached.',
          },
          continuation_token: {
            type: 'string',
            description: 'Optional: Token from previous response to fetch the next chunk of content. Use this for pages without headings that were truncated. Omit url when using this.',
          },
          use_browser: {
            type: 'boolean',
            description: 'Optional: Force the use of a real browser to fetch the page. Use this when the initial fetch fails, returns empty content, or when the page is a Single Page Application (SPA) that requires JavaScript to render correctly (e.g., React, Vue, Angular sites, or sites with complex anti-bot measures).',
          },
        },
        required: [],
      },
    },
  },
});

export default webFetchTool;
