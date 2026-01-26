/**
 * Tests for webFetch tool
 * Covers validation, tool specification, and handler functionality
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { webFetchTool } from '../src/lib/tools/webFetch.js';

// Store original fetch
const originalFetch = global.fetch;
let fetchMock;

// Helper to create a proper mock fetch response
function createMockResponse(htmlContent, options = {}) {
  const {
    ok = true,
    status = 200,
    statusText = 'OK',
    contentType = 'text/html',
  } = options;

  const body = new ReadableStream({
    start(controller) {
      if (htmlContent) {
        controller.enqueue(new TextEncoder().encode(htmlContent));
      }
      controller.close();
    }
  });

  const headers = new Map();
  if (contentType) {
    headers.set('content-type', contentType);
  }

  return {
    ok,
   status,
    statusText,
    headers,
    body,
  };
}

// Set up fetch mock before each test
beforeEach(() => {
  global.fetch = jest.fn();
  fetchMock = global.fetch;
});

// Restore original fetch after each test
afterEach(() => {
  global.fetch = originalFetch;
});

describe('webFetch tool', () => {
  describe('validation', () => {
    test('rejects null or undefined arguments', () => {
      expect(() => webFetchTool.validate(null)).toThrow('web_fetch requires an arguments object');
      expect(() => webFetchTool.validate(undefined)).toThrow('web_fetch requires an arguments object');
    });

    test('rejects non-object arguments', () => {
      expect(() => webFetchTool.validate('string')).toThrow('web_fetch requires an arguments object');
      expect(() => webFetchTool.validate(123)).toThrow('web_fetch requires an arguments object');
    });

    test('rejects missing URL when no continuation_token', () => {
      expect(() => webFetchTool.validate({})).toThrow('web_fetch requires a valid "url" string parameter');
      expect(() => webFetchTool.validate({ url: '' })).toThrow('web_fetch requires a valid "url" string parameter');
      expect(() => webFetchTool.validate({ url: 123 })).toThrow('web_fetch requires a valid "url" string parameter');
    });

    test('rejects invalid URL format', () => {
      expect(() => webFetchTool.validate({ url: 'not-a-url' })).toThrow('Invalid URL format');
      expect(() => webFetchTool.validate({ url: 'file:///etc/passwd' })).not.toThrow(); // Local file URLs are valid
    });

    test('accepts valid URLs', () => {
      const httpResult = webFetchTool.validate({ url: 'http://example.com/page' });
      expect(httpResult.url).toBe('http://example.com/page');

      const httpsResult = webFetchTool.validate({ url: 'https://example.com/page' });
      expect(httpsResult.url).toBe('https://example.com/page');
    });

    test('sets default maxChars', () => {
      const result = webFetchTool.validate({ url: 'https://example.com' });
      expect(result.maxChars).toBe(10000); // DEFAULT_MAX_CHARS
    });

    test('validates max_chars parameter', () => {
      // Too small
      expect(() => webFetchTool.validate({ url: 'https://example.com', max_chars: 100 }))
        .toThrow('max_chars must be a number >= 200');

      // Invalid type
      expect(() => webFetchTool.validate({ url: 'https://example.com', max_chars: 'string' }))
        .toThrow('max_chars must be a number >= 200');

      // Too large
      expect(() => webFetchTool.validate({ url: 'https://example.com', max_chars: 300000 }))
        .toThrow('max_chars cannot exceed 200000');

      // Valid values
      const result = webFetchTool.validate({ url: 'https://example.com', max_chars: 5000 });
      expect(result.maxChars).toBe(5000);

      const minResult = webFetchTool.validate({ url: 'https://example.com', max_chars: 200 });
      expect(minResult.maxChars).toBe(200);

      const maxResult = webFetchTool.validate({ url: 'https://example.com', max_chars: 200000 });
      expect(maxResult.maxChars).toBe(200000);
    });

    test('validates heading parameter as string', () => {
      const result = webFetchTool.validate({ url: 'https://example.com', heading: 'Installation' });
      expect(result.targetHeadings).toEqual(['Installation']);
    });

    test('validates heading parameter as number', () => {
      const result = webFetchTool.validate({ url: 'https://example.com', heading: 2 });
      expect(result.targetHeadings).toEqual([2]);
    });

    test('validates heading parameter as array', () => {
      // Array of strings
      let result = webFetchTool.validate({ url: 'https://example.com', heading: ['Intro', 'Setup'] });
      expect(result.targetHeadings).toEqual(['Intro', 'Setup']);

      // Array with mixed types
      result = webFetchTool.validate({ url: 'https://example.com', heading: [1, 'Setup', 3] });
      expect(result.targetHeadings).toEqual([1, 'Setup', 3]);
    });

    test('heading empty string becomes null', () => {
      const result = webFetchTool.validate({ url: 'https://example.com', heading: '   ' });
      expect(result.targetHeadings).toBeNull();
    });

    test('heading empty array becomes null', () => {
      const result = webFetchTool.validate({ url: 'https://example.com', heading: [] });
      expect(result.targetHeadings).toBeNull();
    });

    test('heading array with only empty strings becomes null', () => {
      const result = webFetchTool.validate({ url: 'https://example.com', heading: ['', '  ', ''] });
      expect(result.targetHeadings).toBeNull();
    });

    test('rejects invalid heading type', () => {
      expect(() => webFetchTool.validate({ url: 'https://example.com', heading: { bad: 'value' } }))
        .toThrow('heading must be a string, number, or an array of strings/numbers');

      expect(() => webFetchTool.validate({ url: 'https://example.com', heading: true }))
        .toThrow('heading must be a string, number, or an array of strings/numbers');
    });

    test('validates use_browser parameter', () => {
      // Boolean true
      let result = webFetchTool.validate({ url: 'https://example.com', use_browser: true });
      expect(result.useBrowser).toBe(true);

      // Boolean false
      result = webFetchTool.validate({ url: 'https://example.com', use_browser: false });
      expect(result.useBrowser).toBe(false);

      // Default
      result = webFetchTool.validate({ url: 'https://example.com' });
      expect(result.useBrowser).toBe(false);

      // Invalid type
      expect(() => webFetchTool.validate({ url: 'https://example.com', use_browser: 'yes' }))
        .toThrow('use_browser must be a boolean');
    });

    test('validates continuation_token', () => {
      // Valid token
      const result = webFetchTool.validate({ continuation_token: 'some-token' });
      expect(result.continuation_token).toBe('some-token');
      expect(result.maxChars).toBe(10000); // Default

      // Invalid type
      expect(() => webFetchTool.validate({ continuation_token: 123 }))
        .toThrow('continuation_token must be a string');

      expect(() => webFetchTool.validate({ continuation_token: ['array'] }))
        .toThrow('continuation_token must be a string');
    });

    test('continuation_token with custom max_chars', () => {
      const result = webFetchTool.validate({ continuation_token: 'token', max_chars: 5000 });
      expect(result.continuation_token).toBe('token');
      expect(result.maxChars).toBe(5000);
    });

    test('continuation_token max_chars validation', () => {
      expect(() => webFetchTool.validate({ continuation_token: 'token', max_chars: 100 }))
        .toThrow('max_chars must be a number >= 200');
    });

    test('all parameters combined', () => {
      const result = webFetchTool.validate({
        url: 'https://example.com/docs',
        max_chars: 15000,
        heading: ['Introduction', 'Installation'],
        use_browser: true
      });

      expect(result.url).toBe('https://example.com/docs');
      expect(result.maxChars).toBe(15000);
      expect(result.targetHeadings).toEqual(['Introduction', 'Installation']);
      expect(result.useBrowser).toBe(true);
    });
  });

  describe('tool specification', () => {
    test('has correct OpenAI function specification', () => {
      expect(webFetchTool.spec.type).toBe('function');
      expect(webFetchTool.spec.function.name).toBe('web_fetch');

      const params = webFetchTool.spec.function.parameters;
      expect(params.type).toBe('object');
      expect(params.properties).toHaveProperty('url');
      expect(params.properties).toHaveProperty('max_chars');
      expect(params.properties).toHaveProperty('heading');
      expect(params.properties).toHaveProperty('continuation_token');
      expect(params.properties).toHaveProperty('use_browser');
    });

    test('url property is correctly defined', () => {
      const urlProp = webFetchTool.spec.function.parameters.properties.url;
      expect(urlProp.type).toBe('string');
      expect(urlProp.description).toBeDefined();
    });

    test('max_chars property is correctly defined', () => {
      const maxCharsProp = webFetchTool.spec.function.parameters.properties.max_chars;
      expect(['number', 'integer']).toContain(maxCharsProp.type);
      expect(maxCharsProp.description).toBeDefined();
    });

    test('has correct tool name and description', () => {
      expect(webFetchTool.name).toBe('web_fetch');
      expect(webFetchTool.description).toBeDefined();
      expect(webFetchTool.description.length).toBeGreaterThan(0);
    });

    test('handler is a function', () => {
      expect(typeof webFetchTool.handler).toBe('function');
    });

    test('validate is a function', () => {
      expect(typeof webFetchTool.validate).toBe('function');
    });
  });

  describe('tool immutability', () => {
    test('tool object is frozen', () => {
      expect(Object.isFrozen(webFetchTool)).toBe(true);
    });

    test('cannot modify tool properties', () => {
      expect(() => {
        webFetchTool.name = 'hacked';
      }).toThrow();
    });
  });

  describe('handler - basic fetch', () => {
    test('fetches and converts simple HTML to markdown', async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>Test Page</title></head>
          <body>
            <h1>Main Title</h1>
            <p>This is a paragraph with some <strong>bold text</strong>.</p>
            <ul>
              <li>Item 1</li>
              <li>Item 2</li>
            </ul>
          </body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://example.com/test',
        maxChars: 10000
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(result.url).toBe('https://example.com/test');
      expect(result.title).toBe('Test Page');
      expect(result.markdown).toContain('Main Title');
      expect(result.markdown).toContain('paragraph');
      expect(result.length).toBeGreaterThan(0);
      expect(result.extractionMethod).toBeDefined();
    });

    test('handles HTTP error responses', async () => {
      const mockResponse = createMockResponse(null, { ok: false, status: 404, statusText: 'Not Found' });
      global.fetch.mockResolvedValue(mockResponse);

      // Verify mock is set up
      expect(global.fetch).toBeDefined();
      expect(typeof fetchMock).toBe('function');

      await expect(webFetchTool.handler({
        url: 'https://example.com/notfound',
        maxChars: 10000
      })).rejects.toThrow('HTTP error! status: 404');

      // Verify mock was called
      expect(global.fetch).toHaveBeenCalled();
    });

    test('handles network errors', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));

      await expect(webFetchTool.handler({
        url: 'https://example.com',
        maxChars: 10000
      })).rejects.toThrow();
    });

    test('handles timeout errors', async () => {
      const timeoutError = new Error('Timeout');
      timeoutError.name = 'AbortError';
      global.fetch.mockRejectedValue(timeoutError);

      // Since browser fallback will be triggered but will also fail,
      // we expect a "Failed to fetch URL" error with both errors listed
      await expect(webFetchTool.handler({
        url: 'https://example.com',
        maxChars: 10000
      })).rejects.toThrow('Failed to fetch URL');
    });

    test('rejects non-text content types', async () => {
      // Create binary data with null bytes to ensure it fails the text heuristic
      const binaryData = new Uint8Array(1024);
      binaryData.fill(0x00); // Fill with null bytes
      binaryData[0] = 0xFF; // JPEG header
      binaryData[1] = 0xD8;
      binaryData[2] = 0xFF;
      binaryData[3] = 0xE0;

      const mockBody = new ReadableStream({
        start(controller) {
          controller.enqueue(binaryData);
          controller.close();
        }
      });

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'image/jpeg']]),
        body: mockBody
      });

      await expect(webFetchTool.handler({
        url: 'https://example.com/image.jpg',
        maxChars: 10000
      })).rejects.toThrow('does not return text-parsable content');
    });

    test('rejects empty response body', async () => {
      global.fetch.mockResolvedValue(createMockResponse(''));

      await expect(webFetchTool.handler({
        url: 'https://example.com',
        maxChars: 10000
      })).rejects.toThrow('Empty response body');
    });

    test('handles responses without readable body', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/html']]),
        body: null // No body at all
      });

      await expect(webFetchTool.handler({
        url: 'https://example.com',
        maxChars: 10000
      })).rejects.toThrow('Response body is not readable');
    });

    test('handles large response with size limit', async () => {
      // Create content larger than MAX_BODY_SIZE
      const largeContent = 'x'.repeat(11 * 1024 * 1024); // 11 MB
      let chunksSent = 0;
      const maxChunks = 100;

      const mockBody = new ReadableStream({
        start(controller) {
          const chunkSize = 1024 * 1024; // 1 MB chunks
          for (let i = 0; i < largeContent.length && chunksSent < maxChunks; i += chunkSize) {
            controller.enqueue(new TextEncoder().encode(largeContent.slice(i, i + chunkSize)));
            chunksSent++;
          }
          controller.close();
        }
      });

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/html']]),
        body: mockBody
      });

      await expect(webFetchTool.handler({
        url: 'https://example.com',
        maxChars: 10000
      })).rejects.toThrow('exceeds maximum size limit');
    });

    test('extracts title from HTML', async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>Custom Page Title</title></head>
          <body><p>Content</p></body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://example.com',
        maxChars: 10000
      });

      expect(result.title).toBe('Custom Page Title');
    });

    test('uses "Untitled" for missing title', async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <body><p>Content without title tag</p></body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://example.com',
        maxChars: 10000
      });

      expect(result.title).toBe('Untitled');
    });
  });

  describe('handler - content extraction', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('extracts headings and builds TOC', async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>Documentation</title></head>
          <body>
            <h1>Getting Started</h1>
            <p>Introduction text</p>
            <h2>Installation</h2>
            <p>Install instructions</p>
            <h2>Configuration</h2>
            <p>Config details</p>
            <h3>Advanced Config</h3>
            <p>Advanced options</p>
          </body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://example.com/docs',
        maxChars: 10000
      });

      expect(result.tableOfContents).toBeDefined();
      expect(result.tableOfContents).toContain('Getting Started');
      expect(result.tableOfContents).toContain('Installation');
      expect(result.tableOfContents).toContain('Configuration');
      expect(result.tableOfContents).toContain('Advanced Config');
      expect(result.headingsCount).toBe(4);
    });

    test('filters content by heading name', async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>Docs</title></head>
          <body>
            <h1>Introduction</h1>
            <p>Intro content that should not appear</p>
            <h1>Installation</h1>
            <p>Installation content that should appear</p>
            <h2>Prerequisites</h2>
            <p>Prereq content that should also appear</p>
            <h1>Usage</h1>
            <p>Usage content that should not appear</p>
          </body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://example.com/docs',
        maxChars: 10000,
        targetHeadings: ['Installation']
      });

      expect(result.markdown).toContain('Installation');
      expect(result.markdown).toContain('Installation content');
      // The filtered content should exclude headings outside the filter range
      expect(result.markdown).not.toContain('Intro content');
      expect(result.markdown).not.toContain('Usage content');
      expect(result.filteredByHeadings).toContain('Installation');
      // Subheadings may or may not be preserved in markdown depending on HTML structure
      // so we just check that the main content is there
    });

    test('filters content by heading index', async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>Docs</title></head>
          <body>
            <h1>First Heading</h1>
            <p>First content</p>
            <h1>Second Heading</h1>
            <p>Second content</p>
            <h1>Third Heading</h1>
            <p>Third content</p>
          </body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://example.com/docs',
        maxChars: 10000,
        targetHeadings: [2] // Second heading (1-based index)
      });

      expect(result.markdown).toContain('Second Heading');
      expect(result.markdown).toContain('Second content');
      expect(result.markdown).not.toContain('First content');
      expect(result.markdown).not.toContain('Third content');
    });

    test('returns error when heading not found', async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>Docs</title></head>
          <body>
            <h1>Available Heading</h1>
            <p>Content</p>
          </body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://example.com/docs',
        maxChars: 10000,
        targetHeadings: ['NonexistentHeading']
      });

      expect(result.headingError).toContain('None of the requested headings found');
      // The heading error contains the actual heading from the mock content
      expect(result.headingError).toMatch(/Available Heading|Example Domain/);
    });

    test('removes scripts, styles, and navigation elements', async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test</title>
            <style>body { color: red; }</style>
          </head>
          <body>
            <nav>Navigation menu</nav>
            <header>Site header</header>
            <script>alert('hello');</script>
            <article>
              <h1>Main Content</h1>
              <p>This is the actual content</p>
            </article>
            <footer>Site footer</footer>
          </body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://example.com',
        maxChars: 10000
      });

      expect(result.markdown).toContain('Main Content');
      expect(result.markdown).toContain('actual content');
      expect(result.markdown).not.toContain('alert');
      expect(result.markdown).not.toContain('color: red');
    });
  });

  describe('handler - specialized extractors', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('uses Reddit extractor for reddit.com URLs', async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>Reddit Post</title></head>
          <body>
            <shreddit-post>
              <h1>Post Title</h1>
              <p>Post content here</p>
            </shreddit-post>
            <shreddit-comment-tree>
              <shreddit-comment>
                <p>Comment 1</p>
              </shreddit-comment>
              <shreddit-comment>
                <p>Comment 2</p>
              </shreddit-comment>
            </shreddit-comment-tree>
          </body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://www.reddit.com/r/test/comments/123',
        maxChars: 10000
      });

      expect(result.extractionMethod).toBe('reddit-custom');
      expect(result.markdown).toContain('Post Title');
      expect(result.markdown).toContain('Post content');
      expect(result.markdown).toContain('Comments');
      expect(result.markdown).toContain('Comment 1');
      expect(result.markdown).toContain('Comment 2');
    });

    test('uses StackOverflow extractor for stackoverflow.com URLs', async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>Question Title - Stack Overflow</title></head>
          <body>
            <div id="question" class="question">
              <div class="js-vote-count">42</div>
              <div class="js-post-body">
                <p>How do I do X?</p>
                <code>sample code</code>
              </div>
            </div>
            <div id="answers">
              <div class="answer accepted-answer">
                <div class="js-vote-count">15</div>
                <div class="js-post-body">
                  <p>You can do it this way</p>
                  <code>solution code</code>
                </div>
              </div>
              <div class="answer">
                <div class="js-vote-count">5</div>
                <div class="js-post-body">
                  <p>Alternative approach</p>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://stackoverflow.com/questions/12345/test-question',
        maxChars: 10000
      });

      expect(result.extractionMethod).toBe('stackoverflow-custom');
      expect(result.markdown).toContain('Question');
      expect(result.markdown).toContain('Votes: 42');
      expect(result.markdown).toContain('How do I do X?');
      expect(result.markdown).toContain('2 Answers');
      expect(result.markdown).toContain('Accepted');
      expect(result.markdown).toContain('Votes: 15');
      expect(result.markdown).toContain('You can do it this way');
      expect(result.markdown).toContain('Alternative approach');
    });

    test('falls back to generic extraction when specialized extractor fails', async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>Reddit-like page</title></head>
          <body>
            <article>
              <h1>Regular Article</h1>
              <p>This page looks like Reddit but has no shreddit-post element</p>
            </article>
          </body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://www.reddit.com/r/test',
        maxChars: 10000
      });

      // Should fall back to readability or selector-based extraction
      expect(result.extractionMethod).not.toBe('reddit-custom');
      expect(result.markdown).toContain('Regular Article');
    });
  });

  describe('handler - truncation and continuation', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('truncates long content at character limit', async () => {
      const longContent = 'a'.repeat(20000);
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>Long Page</title></head>
          <body><p>${longContent}</p></body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://example.com/long',
        maxChars: 1000
      });

      expect(result.length).toBeLessThanOrEqual(1100); // Allow some margin for truncation message
      expect(result.truncated).toBe(true);
      expect(result.originalLength).toBeGreaterThan(result.length);
      expect(result.markdown).toContain('More content available');
    });

    test('provides continuation token for truncated content without headings', async () => {
      const longContent = 'b'.repeat(20000);
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>Long Page</title></head>
          <body><p>${longContent}</p></body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://example.com/long',
        maxChars: 1000
      });

      expect(result.continuation_token).toBeDefined();
      expect(typeof result.continuation_token).toBe('string');
    });

    test('does not provide continuation token for content with headings', async () => {
      const longContent = 'c'.repeat(20000);
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>Long Page</title></head>
          <body>
            <h1>Section 1</h1>
            <p>${longContent}</p>
          </body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://example.com/long',
        maxChars: 1000
      });

      // With headings, continuation token should not be provided
      // (user should use heading parameter instead)
      expect(result.continuation_token).toBeUndefined();
    });

    test('handles continuation token to fetch next chunk', async () => {
      // First, do an initial fetch to get a continuation token
      // Create varied content so chunks will be different
      const paragraphs = [];
      for (let i = 0; i < 200; i++) {
        paragraphs.push(`<p>Paragraph ${i}: This is unique content for paragraph number ${i}. ${'x'.repeat(50)}</p>`);
      }
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>Long Page</title></head>
          <body>${paragraphs.join('\n')}</body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const firstResult = await webFetchTool.handler({
        url: 'https://example.com/long',
        maxChars: 5000
      });

      expect(firstResult.continuation_token).toBeDefined();
      expect(firstResult.truncated).toBe(true);

      // Now use the continuation token to fetch next chunk
      const secondResult = await webFetchTool.handler({
        continuation_token: firstResult.continuation_token,
        maxChars: 5000
      });

      expect(secondResult.url).toBe('https://example.com/long');
      expect(secondResult.title).toBe('Long Page');
      expect(secondResult.markdown).toBeDefined();
      // Verify we got continuation by checking truncation or content difference
      // The continuation may also be truncated if there's more content
      expect(firstResult.length).toBeGreaterThan(100);
      expect(secondResult.length).toBeGreaterThan(100);
    });

    test('throws error for invalid continuation token', async () => {
      await expect(webFetchTool.handler({
        continuation_token: 'invalid-token-that-does-not-exist',
        maxChars: 1000
      })).rejects.toThrow('Continuation token expired or invalid');
    });

    test('does not truncate short content', async () => {
      const shortContent = 'Short text';
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>Short Page</title></head>
          <body><p>${shortContent}</p></body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://example.com/short',
        maxChars: 10000
      });

      expect(result.truncated).toBe(false);
      expect(result.continuation_token).toBeUndefined();
      expect(result.markdown).not.toContain('More content available');
    });
  });

  describe('handler - metadata extraction', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('extracts published time from meta tags', async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Article</title>
            <meta property="article:published_time" content="2024-01-15T10:30:00Z">
          </head>
          <body><p>Article content</p></body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://example.com/article',
        maxChars: 10000
      });

      expect(result.publishedTime).toBe('2024-01-15T10:30:00Z');
    });

    test('extracts published time from time element', async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>Article</title></head>
          <body>
            <time datetime="2024-02-20T15:45:00Z">February 20, 2024</time>
            <p>Article content</p>
          </body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://example.com/article',
        maxChars: 10000
      });

      expect(result.publishedTime).toBe('2024-02-20T15:45:00Z');
    });

    test('extracts published time from JSON-LD', async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Article</title>
            <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Article",
              "datePublished": "2024-03-10T12:00:00Z",
              "headline": "Test Article"
            }
            </script>
          </head>
          <body><p>Article content</p></body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://example.com/article',
        maxChars: 10000
      });

      expect(result.publishedTime).toBe('2024-03-10T12:00:00Z');
    });

    test('handles missing published time gracefully', async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>Article</title></head>
          <body><p>Article content without date</p></body>
        </html>
      `;

      global.fetch.mockResolvedValue(createMockResponse(htmlContent));

      const result = await webFetchTool.handler({
        url: 'https://example.com/article',
        maxChars: 10000
      });

      expect(result.publishedTime).toBeNull();
    });
  });

  describe('handler - browser fallback', () => {
    let mockBrowserService;

    beforeEach(() => {
      global.fetch = jest.fn();
      jest.resetModules();

      // Mock browserService
      mockBrowserService = {
        fetchPageContent: jest.fn()
      };
    });

    afterEach(() => {
      global.fetch = originalFetch;
      jest.resetModules();
    });

    test('uses browser when use_browser is true', async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>Browser Fetched</title></head>
          <body><p>Content fetched via browser</p></body>
        </html>
      `;

      mockBrowserService.fetchPageContent.mockResolvedValue(htmlContent);

      // Mock the browserService module
      jest.unstable_mockModule('../src/lib/browser/BrowserService.js', () => ({
        browserService: mockBrowserService
      }));

      const { webFetchTool: mockedTool } = await import('../src/lib/tools/webFetch.js');

      const result = await mockedTool.handler({
        url: 'https://example.com',
        maxChars: 10000,
        useBrowser: true
      });

      expect(mockBrowserService.fetchPageContent).toHaveBeenCalledWith(
        'https://example.com',
        {}
      );
      expect(result.title).toBe('Browser Fetched');
      expect(result.markdown).toContain('Content fetched via browser');
    });

    test('passes waitSelector option for StackOverflow URLs with browser', async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head><title>SO Question</title></head>
          <body>
            <div id="question-header">Question</div>
            <div class="question"><div class="js-post-body"><p>Content</p></div></div>
          </body>
        </html>
      `;

      mockBrowserService.fetchPageContent.mockResolvedValue(htmlContent);

      jest.unstable_mockModule('../src/lib/browser/BrowserService.js', () => ({
        browserService: mockBrowserService
      }));

      const { webFetchTool: mockedTool } = await import('../src/lib/tools/webFetch.js');

      await mockedTool.handler({
        url: 'https://stackoverflow.com/questions/123',
        maxChars: 10000,
        useBrowser: true
      });

      expect(mockBrowserService.fetchPageContent).toHaveBeenCalledWith(
        'https://stackoverflow.com/questions/123',
        { waitSelector: '#question-header' }
      );
    });

    test('falls back to browser on SPA detection', async () => {
      const spaHtml = `
        <!DOCTYPE html>
        <html>
          <head><title>Just a moment...</title></head>
          <body>
            <noscript>You need to enable JavaScript to run this app.</noscript>
            <div id="root"></div>
          </body>
        </html>
      `;

      const fullHtml = `
        <!DOCTYPE html>
        <html>
          <head><title>Full Content</title></head>
          <body>
            <div id="root">
              <h1>Actual Content</h1>
              <p>This was loaded by JavaScript</p>
            </div>
          </body>
        </html>
      `;

      // First call returns SPA stub
      const spaBody = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(spaHtml));
          controller.close();
        }
      });

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/html']]),
        body: spaBody
      });

      mockBrowserService.fetchPageContent.mockResolvedValue(fullHtml);

      jest.unstable_mockModule('../src/lib/browser/BrowserService.js', () => ({
        browserService: mockBrowserService
      }));

      const { webFetchTool: mockedTool } = await import('../src/lib/tools/webFetch.js');

      const result = await mockedTool.handler({
        url: 'https://example.com/app',
        maxChars: 10000
      });

      // Should have fallen back to browser
      expect(mockBrowserService.fetchPageContent).toHaveBeenCalled();
      expect(result.markdown).toContain('Actual Content');
      expect(result.markdown).toContain('loaded by JavaScript');
    });

    test('throws error when forced browser fetch fails', async () => {
      mockBrowserService.fetchPageContent.mockRejectedValue(new Error('Browser timeout'));

      jest.unstable_mockModule('../src/lib/browser/BrowserService.js', () => ({
        browserService: mockBrowserService
      }));

      const { webFetchTool: mockedTool } = await import('../src/lib/tools/webFetch.js');

      await expect(mockedTool.handler({
        url: 'https://example.com',
        maxChars: 10000,
        useBrowser: true
      })).rejects.toThrow('Forced browser fetch failed: Browser timeout');
    });
  });
});
