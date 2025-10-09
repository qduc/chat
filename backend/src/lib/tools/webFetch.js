import { createTool } from './baseTool.js';
import TurndownService from 'turndown';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

const TOOL_NAME = 'web_fetch';

// Minimum content length thresholds (relaxed to get more content for RAG filtering)
const MIN_READABILITY_LENGTH = 200; // Relaxed from 500
const MIN_SELECTOR_LENGTH = 300;

// Maximum output length to prevent token overflow
const DEFAULT_MAX_CHARS = 50000; // ~12,500 tokens at 4 chars/token
const MAX_CHARS_LIMIT = 200000; // Hard limit: ~50,000 tokens

function validate(args) {
  if (!args || typeof args !== 'object') {
    throw new Error('web_fetch requires an arguments object');
  }

  const { url, max_chars } = args;

  if (!url || typeof url !== 'string') {
    throw new Error('web_fetch requires a valid "url" string parameter');
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch (error) {
    throw new Error(`Invalid URL format: ${url}`);
  }

  // Validate max_chars if provided
  let maxChars = DEFAULT_MAX_CHARS;
  if (max_chars !== undefined) {
    if (typeof max_chars !== 'number' || max_chars < 1000) {
      throw new Error('max_chars must be a number >= 1000');
    }
    if (max_chars > MAX_CHARS_LIMIT) {
      throw new Error(`max_chars cannot exceed ${MAX_CHARS_LIMIT}`);
    }
    maxChars = max_chars;
  }

  return { url, maxChars };
}

async function handler({ url, maxChars }) {
  try {
    // Fetch the web page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ChatForge/1.0; +https://chatforge.app)',
      },
      redirect: 'follow',
      // 10 second timeout
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';

    // Check if the response is HTML
    if (!contentType.includes('text/html')) {
      throw new Error(`URL does not return HTML content. Content-Type: ${contentType}`);
    }

    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;

    // Try multiple extraction strategies (ordered by quality)
    let extractedContent = null;
    let method = 'unknown';

    // Strategy 1: Try Readability first (reliable, well-tested)
    // Threshold relaxed to 200 chars to get more content for potential RAG filtering
    try {
      const reader = new Readability(document.cloneNode(true));
      const article = reader.parse();

      if (article && article.textContent && article.textContent.length > MIN_READABILITY_LENGTH) {
        extractedContent = {
          html: article.content,
          title: article.title,
          excerpt: article.excerpt,
          byline: article.byline,
        };
        method = 'readability';
      }
    } catch (error) {
      // Readability failed, continue to next strategy
    }

    // Strategy 2: Try finding main content elements
    if (!extractedContent) {
      const mainSelectors = [
        '#content', // Common in documentation sites
        'main',
        'article',
        '[role="main"]',
        '.main-content',
        '#main-content',
        '.markdown',
        '.prose',
        '.documentation',
        '.docs-content',
        '.mdx-content',
      ];

      for (const selector of mainSelectors) {
        const mainElement = document.querySelector(selector);
        if (mainElement && mainElement.textContent.trim().length > MIN_SELECTOR_LENGTH) {
          extractedContent = {
            html: mainElement.innerHTML,
            title: extractTitle(html),
          };
          method = `selector:${selector}`;
          break;
        }
      }
    }

    // Strategy 3: Fallback to basic cleaning
    if (!extractedContent) {
      const cleanedHtml = cleanHtml(html);
      extractedContent = {
        html: cleanedHtml,
        title: extractTitle(html),
      };
      method = 'basic-clean';
    }

    // Convert to Markdown
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });

    let markdown = turndownService.turndown(extractedContent.html);

    // Apply character limit
    const truncationResult = truncateMarkdown(markdown, maxChars);
    markdown = truncationResult.markdown;

    return {
      url,
      title: extractedContent.title || 'Untitled',
      markdown,
      length: markdown.length,
      excerpt: extractedContent.excerpt,
      byline: extractedContent.byline,
      extractionMethod: method, // For debugging
      truncated: truncationResult.truncated,
      ...(truncationResult.truncated && { originalLength: truncationResult.originalLength }),
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout: The page took too long to load');
    }
    throw new Error(`Failed to fetch URL: ${error.message}`);
  }
}

function cleanHtml(html) {
  // Remove script tags and their content
  let cleaned = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove style tags and their content
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove inline styles
  cleaned = cleaned.replace(/\s+style\s*=\s*["'][^"']*["']/gi, '');

  // Remove comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

  // Remove nav, header, footer elements (common non-content sections)
  cleaned = cleaned.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '');
  cleaned = cleaned.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '');
  cleaned = cleaned.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '');

  // Remove iframe, video, audio tags
  cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  cleaned = cleaned.replace(/<video\b[^<]*(?:(?!<\/video>)<[^<]*)*<\/video>/gi, '');
  cleaned = cleaned.replace(/<audio\b[^<]*(?:(?!<\/audio>)<[^<]*)*<\/audio>/gi, '');

  return cleaned;
}

function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch ? titleMatch[1].trim() : 'Untitled';
}

function truncateMarkdown(markdown, maxChars) {
  if (markdown.length <= maxChars) {
    return { markdown, truncated: false };
  }

  // Find a good breaking point (end of sentence or paragraph)
  let breakPoint = maxChars;

  // Try to break at paragraph boundary (double newline)
  const paragraphBreak = markdown.lastIndexOf('\n\n', maxChars);
  if (paragraphBreak > maxChars * 0.8) {
    // If we can break within last 20% of max length, use paragraph break
    breakPoint = paragraphBreak;
  } else {
    // Otherwise try to break at sentence boundary
    const sentenceBreak = markdown.lastIndexOf('. ', maxChars);
    if (sentenceBreak > maxChars * 0.8) {
      breakPoint = sentenceBreak + 1; // Include the period
    } else {
      // Last resort: break at word boundary
      const spaceBreak = markdown.lastIndexOf(' ', maxChars);
      if (spaceBreak > maxChars * 0.9) {
        breakPoint = spaceBreak;
      }
    }
  }

  const truncatedMarkdown = markdown.substring(0, breakPoint).trim() + '\n\n[... Content truncated ...]';

  return {
    markdown: truncatedMarkdown,
    truncated: true,
    originalLength: markdown.length,
  };
}

export const webFetchTool = createTool({
  name: TOOL_NAME,
  description: 'Fetch a web page and convert its HTML content to Markdown format',
  validate,
  handler,
  openAI: {
    type: 'function',
    function: {
      name: TOOL_NAME,
      description:
        'Fetch a web page and convert its HTML content to Markdown format. Returns the page title and content as markdown. Use max_chars to limit output length.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL of the web page to fetch',
          },
          max_chars: {
            type: 'number',
            description: `Maximum number of characters to return (default: ${DEFAULT_MAX_CHARS}). Content will be intelligently truncated at paragraph/sentence boundaries if needed.`,
          },
        },
        required: ['url'],
      },
    },
  },
});

export default webFetchTool;
