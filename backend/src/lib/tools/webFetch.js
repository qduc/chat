import { createTool } from './baseTool.js';
import TurndownService from 'turndown';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { browserService } from '../browser/BrowserService.js';

const TOOL_NAME = 'web_fetch';

// Minimum content length thresholds (relaxed to get more content for RAG filtering)
const MIN_READABILITY_LENGTH = 300; // Relaxed from 500
const MIN_SELECTOR_LENGTH = 300;

// Maximum output length to prevent token overflow
const DEFAULT_MAX_CHARS = 10000; // Increased from 5000 for better context
const MAX_CHARS_LIMIT = 200000; // Hard limit: ~50,000 tokens

// Maximum body size to prevent memory issues (10 MB)
const MAX_BODY_SIZE = 10 * 1024 * 1024;

// Content cache for continuation support
const contentCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_SWEEP_INTERVAL = 60 * 1000; // Check every minute

// Clean up expired cache entries periodically
const cacheCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of contentCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      contentCache.delete(key);
    }
  }
}, CACHE_SWEEP_INTERVAL);

// Allow Node.js process to exit even if the interval is still scheduled (important for tests)
if (typeof cacheCleanupTimer.unref === 'function') {
  cacheCleanupTimer.unref();
}

function validate(args) {
  if (!args || typeof args !== 'object') {
    throw new Error('web_fetch requires an arguments object');
  }

  const { url, max_chars, continuation_token, heading_range } = args;

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

  // Validate heading if provided
  const { heading } = args;
  let targetHeading = null;
  if (heading !== undefined && heading !== null) {
    if (typeof heading === 'string') {
      if (heading.trim().length === 0) {
        // Treat empty/whitespace heading as not entered
        targetHeading = null;
      } else {
        targetHeading = heading.trim();
      }
    } else {
      throw new Error('heading must be a string');
    }
  }

  // Validate heading_range if provided
  let headingRange = null;
  if (heading_range !== undefined) {
    if (typeof heading_range !== 'object' || heading_range === null) {
      throw new Error('heading_range must be an object with start and end properties');
    }
    const { start, end } = heading_range;
    if (typeof start !== 'number' || typeof end !== 'number') {
      throw new Error('heading_range.start and heading_range.end must be numbers');
    }
    if (start < 1 || end < start) {
      throw new Error('heading_range must have start >= 1 and end >= start');
    }
    headingRange = { start, end };
  }

  // Can't use both heading and heading_range
  if (targetHeading && headingRange) {
    throw new Error('Cannot use both "heading" and "heading_range" parameters');
  }

  return { url, maxChars, targetHeading, headingRange };
}

function generateCacheKey(url, filterType, filterValue) {
  return `${url}:${filterType}:${JSON.stringify(filterValue)}:${Date.now()}`;
}

function handleContinuation(token, maxChars) {
  const cached = contentCache.get(token);

  if (!cached) {
    throw new Error('Continuation token expired or invalid. Please fetch the URL again.');
  }

  const { markdown, offset, url, title, metadata } = cached;
  const truncationResult = truncateMarkdown(markdown, maxChars, offset);

  // Generate new continuation token if there's more content
  let nextToken = null;
  if (truncationResult.hasMore) {
    nextToken = generateCacheKey(url, 'continuation', truncationResult.nextOffset);
    contentCache.set(nextToken, {
      markdown,
      offset: truncationResult.nextOffset,
      url,
      title,
      metadata,
      timestamp: Date.now()
    });
  }

  return {
    url,
    title,
    markdown: truncationResult.markdown,
    length: truncationResult.markdown.length,
    truncated: truncationResult.hasMore,
    ...(truncationResult.hasMore && {
      continuation_token: nextToken,
      originalLength: truncationResult.originalLength
    }),
    ...metadata
  };
}

// Helper: detect if a small binary buffer looks like text
function isProbablyText(buffer) {
  if (!buffer || buffer.length === 0) return false;

  // Quick null-byte check (very likely binary)
  const sampleLen = Math.min(buffer.length, 1024);
  for (let i = 0; i < sampleLen; i++) {
    if (buffer[i] === 0) return false;
  }

  // Decode and examine printable vs control chars
  const sample = new TextDecoder('utf-8', { fatal: false }).decode(buffer.slice(0, sampleLen));
  let nonPrintable = 0;
  let total = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    // allow common whitespace: tab, line feed, carriage return
    if (code === 9 || code === 10 || code === 13) {
      total++;
      continue;
    }
    if (code < 32) {
      nonPrintable++;
    }
    total++;
  }
  if (total === 0) return false;
  // If less than 10% of the sample are non-printable control chars,
  // treat it as text.
  return (nonPrintable / total) < 0.10;
}

async function basicFetch(url) {
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

  // If the Content-Type clearly indicates text-like content, accept it.
  // Otherwise we'll peek at the first chunk of the body and apply a
  // lightweight binary-vs-text heuristic to decide if the response is
  // text-parsable. This allows fetching resources that may not set
  // Content-Type correctly but are still text (e.g., some servers).
  const contentTypeLooksLikeText = /^(?:text\/)|(?:application\/(?:xml|xhtml\+xml|json))|html|xml|json/i.test(contentType);

  // Stream response body with size limit to prevent memory blowup
  const reader = response.body && typeof response.body.getReader === 'function'
    ? response.body.getReader()
    : null;

  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let html = '';
  let bytesDownloaded = 0;

  try {
    // Read the first chunk to allow content sniffing when needed
    const first = await reader.read();
    if (first.done) {
      reader.releaseLock();
      throw new Error('Empty response body');
    }

    const firstChunk = first.value;
    bytesDownloaded += firstChunk.length;

    if (bytesDownloaded > MAX_BODY_SIZE) {
      reader.cancel();
      throw new Error(`Response body exceeds maximum size limit of ${MAX_BODY_SIZE / (1024 * 1024)} MB`);
    }

    if (!contentTypeLooksLikeText) {
      // If the header doesn't clearly say text, use the heuristic on the
      // first chunk to avoid reading binary blobs.
      if (!isProbablyText(firstChunk)) {
        reader.cancel();
        throw new Error(`URL does not return text-parsable content. Content-Type: ${contentType}`);
      }
    }

    // Append first chunk and continue streaming the rest
    html += decoder.decode(firstChunk, { stream: true });

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      bytesDownloaded += value.length;

      if (bytesDownloaded > MAX_BODY_SIZE) {
        reader.cancel();
        throw new Error(`Response body exceeds maximum size limit of ${MAX_BODY_SIZE / (1024 * 1024)} MB`);
      }

      html += decoder.decode(value, { stream: true });
    }

    // Flush any remaining bytes in the decoder
    html += decoder.decode();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  return html;
}

async function handler({ url, maxChars, targetHeading, headingRange, continuation_token }) {
  // Handle continuation token (fetch next chunk from cache)
  if (continuation_token) {
    return handleContinuation(continuation_token, maxChars);
  }

  let html = '';
  let errorMessages = [];

  // 1. Try simple fetch + JSDOM first (fastest)
  try {
    html = await basicFetch(url);
  } catch (error) {
    errorMessages.push(`Basic fetch failed: ${error.message}`);
  }

  // 2. Check for failure triggers (SPA detection)
  // - No content (fetch failed)
  // - Very short content (<300 chars usually means stub)
  // - Specific "Enable JS" messages
  // - noscript tag containing JavaScript requirement messages (not just any noscript tag)
  const noscriptNeedsJs = /<noscript[^>]*>.*?(?:enable|require|need).*?javascript/is.test(html);
  const isFailure = !html
    || html.length < 300
    || html.includes("You need to enable JavaScript")
    || noscriptNeedsJs;

  // 3. Fallback to Browser Engine if needed
  if (isFailure) {
    try {
      // console.log(`Triggering browser fallback for ${url}`);
      html = await browserService.fetchPageContent(url);
    } catch (browserError) {
      console.error('[webFetch] Browser fallback failed:', browserError);
      errorMessages.push(`Browser fallback failed: ${browserError.message}`);

      // If we have some content from basic fetch, usage it despite being "low quality" is better than crashing
      // But if we have NO content, throw exception.
      if (!html) {
        throw new Error(`Failed to fetch URL. Errors: ${errorMessages.join('; ')}`);
      }
    }
  }



  try {
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
          length: article.length,        // Word count estimate
          siteName: article.siteName,    // Site metadata
          lang: article.lang,            // Language detection
          publishedTime: article.publishedTime,
        };
        method = 'readability';
      }
    } catch {
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

    // Extract headings FIRST from the full content (before any filtering or truncation)
    // This ensures the TOC contains all headings from the original document
    const allHeadings = extractHeadings(extractedContent.html);
    const fullToc = buildTOC(allHeadings);

    // STRATEGY 1: Heading-based filtering (preferred for structured content)
    let filterResult = { html: extractedContent.html, filtered: false };
    let filterMetadata = {};

    if (headingRange) {
      // Filter by heading range (e.g., headings 2-4)
      filterResult = filterContentByHeadingRange(extractedContent.html, allHeadings, headingRange);

      if (filterResult.error) {
        filterMetadata.headingError = filterResult.error;
      } else if (filterResult.filtered) {
        extractedContent.html = filterResult.html;
        filterMetadata.filteredByHeadingRange = headingRange;
        filterMetadata.matchedHeadings = filterResult.matchedHeadings;
      }
    } else if (targetHeading) {
      // Filter by single heading name
      filterResult = filterContentByHeading(extractedContent.html, allHeadings, targetHeading);

      if (filterResult.error) {
        filterMetadata.headingError = filterResult.error;
      } else if (filterResult.filtered) {
        extractedContent.html = filterResult.html;
        filterMetadata.filteredByHeading = filterResult.matchedHeading;
      }
    }

    // Convert to Markdown
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });

    let markdown = turndownService.turndown(extractedContent.html);

    // STRATEGY 2: If page has no headings, use continuation token approach
    const usesContinuation = allHeadings.length === 0 && !targetHeading && !headingRange;

    // Apply character limit
    const truncationResult = truncateMarkdown(markdown, maxChars, 0);
    markdown = truncationResult.markdown;

    // Generate continuation token if truncated and no headings available
    let continuationToken = null;
    if (usesContinuation && truncationResult.hasMore) {
      continuationToken = generateCacheKey(url, 'continuation', truncationResult.nextOffset);
      contentCache.set(continuationToken, {
        markdown: turndownService.turndown(extractedContent.html), // Full markdown
        offset: truncationResult.nextOffset,
        url,
        title: extractedContent.title || 'Untitled',
        metadata: {
          excerpt: extractedContent.excerpt,
          byline: extractedContent.byline,
          extractionMethod: method,
        },
        timestamp: Date.now()
      });
    }

    // Prepend TOC to markdown if available (TOC is from FULL content, even if markdown is truncated)
    let finalMarkdown = markdown;
    if (fullToc && !filterMetadata.filteredByHeading && !filterMetadata.filteredByHeadingRange) {
      // Only include TOC if we're showing full content (not filtered to a specific heading)
      finalMarkdown = `## Table of Contents\n\n${fullToc}\n\n---\n\n${markdown}`;
    }

    return {
      url,
      title: extractedContent.title || 'Untitled',
      markdown: finalMarkdown,
      length: finalMarkdown.length,
      excerpt: extractedContent.excerpt,
      byline: extractedContent.byline,
      extractionMethod: method, // For debugging
      truncated: truncationResult.hasMore,
      ...(truncationResult.hasMore && { originalLength: truncationResult.originalLength }),
      ...(continuationToken && { continuation_token: continuationToken }),
      ...(fullToc && { tableOfContents: fullToc }),
      ...(allHeadings && allHeadings.length > 0 && { headingsCount: allHeadings.length }),
      ...filterMetadata,
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout: The page took too long to load');
    }
    throw new Error(`Failed to fetch URL: ${error.message}`);
  }
}

function extractHeadings(htmlContent) {
  // Parse headings (h1-h3) from HTML
  const headingRegex = /<h([1-3])[^>]*>(.*?)<\/h\1>/gi;
  const headings = [];
  let match;

  while ((match = headingRegex.exec(htmlContent)) !== null) {
    const level = parseInt(match[1]);
    const text = match[2]
      .replace(/<[^>]*>/g, '') // Remove any nested tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();

    if (text) {
      headings.push({ level, text, position: match.index });
    }
  }

  return headings;
}

function buildTOC(headings) {
  if (!headings || headings.length === 0) {
    return null;
  }

  const toc = [];
  for (const heading of headings) {
    const indent = '  '.repeat(heading.level - 1);
    toc.push(`${indent}- ${heading.text}`);
  }

  return toc.join('\n');
}

function filterContentByHeading(htmlContent, headings, targetHeading) {
  if (!targetHeading || !headings || headings.length === 0) {
    return { html: htmlContent, filtered: false };
  }

  // Find the target heading (case-insensitive partial match)
  const targetLower = targetHeading.toLowerCase();
  const matchIndex = headings.findIndex(h =>
    h.text.toLowerCase().includes(targetLower) ||
    targetLower.includes(h.text.toLowerCase())
  );

  if (matchIndex === -1) {
    return {
      html: htmlContent,
      filtered: false,
      error: `Heading "${targetHeading}" not found. Available headings: ${headings.map(h => h.text).join(', ')}`
    };
  }

  const targetHeadingObj = headings[matchIndex];
  const startPos = targetHeadingObj.position;

  // Find the end position (next heading of same or higher level, or end of content)
  let endPos = htmlContent.length;
  for (let i = matchIndex + 1; i < headings.length; i++) {
    if (headings[i].level <= targetHeadingObj.level) {
      endPos = headings[i].position;
      break;
    }
  }

  const filteredHtml = htmlContent.substring(startPos, endPos);

  return {
    html: filteredHtml,
    filtered: true,
    matchedHeading: targetHeadingObj.text
  };
}

function filterContentByHeadingRange(htmlContent, headings, range) {
  if (!range || !headings || headings.length === 0) {
    return { html: htmlContent, filtered: false };
  }

  const { start, end } = range;

  // Validate range against available headings (1-indexed)
  if (start > headings.length) {
    return {
      html: htmlContent,
      filtered: false,
      error: `Start index ${start} exceeds available headings (${headings.length} total). Available headings: ${headings.map((h, i) => `${i + 1}. ${h.text}`).join(', ')}`
    };
  }

  const actualEnd = Math.min(end, headings.length);
  const startIndex = start - 1; // Convert to 0-indexed
  const endIndex = actualEnd - 1;

  const startHeading = headings[startIndex];
  const startPos = startHeading.position;

  // Find end position (start of next heading after the range, or end of content)
  let endPos = htmlContent.length;
  if (endIndex + 1 < headings.length) {
    // Check if next heading is at same or higher level as any in our range
    const nextHeading = headings[endIndex + 1];
    const minLevelInRange = Math.min(...headings.slice(startIndex, endIndex + 1).map(h => h.level));

    if (nextHeading.level <= minLevelInRange) {
      endPos = nextHeading.position;
    } else {
      // Include subheadings, find next heading at same or higher level
      for (let i = endIndex + 2; i < headings.length; i++) {
        if (headings[i].level <= minLevelInRange) {
          endPos = headings[i].position;
          break;
        }
      }
    }
  }

  const filteredHtml = htmlContent.substring(startPos, endPos);
  const matchedHeadings = headings.slice(startIndex, endIndex + 1).map(h => h.text);

  return {
    html: filteredHtml,
    filtered: true,
    matchedHeadings
  };
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

function truncateMarkdown(markdown, maxChars, offset = 0) {
  const totalLength = markdown.length;
  const start = offset;
  const end = Math.min(start + maxChars, totalLength);

  // If offset is beyond content, return empty
  if (start >= totalLength) {
    return {
      markdown: '',
      hasMore: false,
      truncated: false,
      originalLength: totalLength
    };
  }

  // If we can fit all remaining content, return it
  if (end >= totalLength) {
    return {
      markdown: markdown.substring(start).trim(),
      hasMore: false,
      truncated: false,
      originalLength: totalLength
    };
  }

  // Find a good breaking point (end of sentence or paragraph)
  let breakPoint = end;

  // Try to break at paragraph boundary (double newline)
  const paragraphBreak = markdown.lastIndexOf('\n\n', end);
  if (paragraphBreak > start && paragraphBreak > end * 0.8) {
    // If we can break within last 20% of max length, use paragraph break
    breakPoint = paragraphBreak;
  } else {
    // Otherwise try to break at sentence boundary
    const sentenceBreak = markdown.lastIndexOf('. ', end);
    if (sentenceBreak > start && sentenceBreak > end * 0.8) {
      breakPoint = sentenceBreak + 1; // Include the period
    } else {
      // Last resort: break at word boundary
      const spaceBreak = markdown.lastIndexOf(' ', end);
      if (spaceBreak > start && spaceBreak > end * 0.9) {
        breakPoint = spaceBreak;
      }
    }
  }

  const chunk = markdown.substring(start, breakPoint).trim();
  const truncatedMarkdown = chunk + '\n\n[... More content available ...]';

  return {
    markdown: truncatedMarkdown,
    hasMore: true,
    truncated: true,
    originalLength: totalLength,
    nextOffset: breakPoint
  };
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
        'Fetch a web page and convert its HTML content to Markdown format. Returns the page title and content as markdown. Automatically detects headings (h1-h3) and includes a table of contents.\n\nNavigation strategies:\n1. For structured content with headings: Use heading or heading_range to get specific sections\n2. For unstructured content: Use continuation_token to fetch subsequent chunks\n\nThe tool automatically chooses the best strategy based on content structure.',
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
            type: 'string',
            description: 'Optional: Retrieve content under a specific heading (h1-h3). Performs case-insensitive partial matching. Returns error with available headings if not found.',
          },
          heading_range: {
            type: 'object',
            description: 'Optional: Retrieve content from a range of headings by index (1-based). Example: {start: 2, end: 4} gets content from 2nd to 4th heading. Includes all subheadings within range.',
            properties: {
              start: {
                type: 'number',
                description: 'Starting heading index (1-based, inclusive)'
              },
              end: {
                type: 'number',
                description: 'Ending heading index (1-based, inclusive)'
              }
            },
            required: ['start', 'end']
          },
          continuation_token: {
            type: 'string',
            description: 'Optional: Token from previous response to fetch the next chunk of content. Use this for pages without headings that were truncated. Omit url when using this.',
          },
        },
        required: [],
      },
    },
  },
});

export default webFetchTool;
