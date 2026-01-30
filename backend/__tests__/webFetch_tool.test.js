/**
 * Tests for webFetch tool
 * Covers validation, tool specification, and handler functionality
 *
 * Note: This file tests the webFetch tool which uses @qduc/web-fetch package.
 * Tests mock the fetchWebPage function to avoid real network requests.
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock the @qduc/web-fetch module before importing webFetchTool
const mockFetchWebPage = jest.fn();
jest.unstable_mockModule('@qduc/web-fetch', () => ({
  fetchWebPage: mockFetchWebPage,
}));

// Must import after mocking
const { webFetchTool } = await import('../src/lib/tools/webFetch.js');

// Helper to create mock result from fetchWebPage
function createMockFetchResult(options = {}) {
  const {
    url = 'https://example.com',
    title = 'Test Page',
    markdown = 'Test content',
    method = 'readability',
    toc = null,
    continuationToken = null,
  } = options;

  return {
    url,
    title,
    markdown,
    method,
    toc,
    continuationToken,
  };
}

// Set up mock before each test
beforeEach(() => {
  mockFetchWebPage.mockReset();
});

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
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
      mockFetchWebPage.mockResolvedValue(createMockFetchResult({
        url: 'https://example.com/test',
        title: 'Test Page',
        markdown: '# Main Title\n\nThis is a paragraph with some **bold text**.\n\n- Item 1\n- Item 2',
        method: 'readability',
      }));

      const result = await webFetchTool.handler({
        url: 'https://example.com/test',
        maxChars: 10000
      });

      expect(mockFetchWebPage).toHaveBeenCalledTimes(1);
      expect(result.url).toBe('https://example.com/test');
      expect(result.title).toBe('Test Page');
      expect(result.markdown).toContain('Main Title');
      expect(result.markdown).toContain('paragraph');
      expect(result.length).toBeGreaterThan(0);
      expect(result.extractionMethod).toBe('readability');
    });

    test('handles HTTP error responses', async () => {
      mockFetchWebPage.mockRejectedValue(new Error('HTTP error! status: 404'));

      await expect(webFetchTool.handler({
        url: 'https://example.com/notfound',
        maxChars: 10000
      })).rejects.toThrow('Failed to fetch URL: HTTP error! status: 404');
    });

    test('handles network errors', async () => {
      mockFetchWebPage.mockRejectedValue(new Error('Network error'));

      await expect(webFetchTool.handler({
        url: 'https://example.com',
        maxChars: 10000
      })).rejects.toThrow('Failed to fetch URL: Network error');
    });

    test('handles timeout errors', async () => {
      const timeoutError = new Error('Timeout');
      timeoutError.name = 'AbortError';
      mockFetchWebPage.mockRejectedValue(timeoutError);

      await expect(webFetchTool.handler({
        url: 'https://example.com',
        maxChars: 10000
      })).rejects.toThrow('Request timeout: The page took too long to load');
    });

    test('handles content type errors', async () => {
      mockFetchWebPage.mockRejectedValue(new Error('URL does not return text-parsable content'));

      await expect(webFetchTool.handler({
        url: 'https://example.com/image.jpg',
        maxChars: 10000
      })).rejects.toThrow('does not return text-parsable content');
    });

    test('handles empty response body', async () => {
      mockFetchWebPage.mockRejectedValue(new Error('Empty response body'));

      await expect(webFetchTool.handler({
        url: 'https://example.com',
        maxChars: 10000
      })).rejects.toThrow('Empty response body');
    });

    test('handles large response with size limit', async () => {
      mockFetchWebPage.mockRejectedValue(new Error('Response body exceeds maximum size limit'));

      await expect(webFetchTool.handler({
        url: 'https://example.com',
        maxChars: 10000
      })).rejects.toThrow('exceeds maximum size limit');
    });

    test('extracts title from result', async () => {
      mockFetchWebPage.mockResolvedValue(createMockFetchResult({
        url: 'https://example.com',
        title: 'Custom Page Title',
        markdown: 'Content',
      }));

      const result = await webFetchTool.handler({
        url: 'https://example.com',
        maxChars: 10000
      });

      expect(result.title).toBe('Custom Page Title');
    });

    test('uses "Untitled" for missing title', async () => {
      mockFetchWebPage.mockResolvedValue(createMockFetchResult({
        url: 'https://example.com',
        title: null,
        markdown: 'Content without title tag',
      }));

      const result = await webFetchTool.handler({
        url: 'https://example.com',
        maxChars: 10000
      });

      expect(result.title).toBe('Untitled');
    });
  });

  describe('handler - content extraction', () => {
    test('includes TOC when present in result', async () => {
      mockFetchWebPage.mockResolvedValue(createMockFetchResult({
        url: 'https://example.com/docs',
        title: 'Documentation',
        markdown: '# Getting Started\n\nIntroduction text\n\n## Installation\n\nInstall instructions',
        toc: '1. Getting Started\n  1. Installation\n  2. Configuration\n    1. Advanced Config',
        method: 'readability',
      }));

      const result = await webFetchTool.handler({
        url: 'https://example.com/docs',
        maxChars: 10000
      });

      expect(result.tableOfContents).toBeDefined();
      expect(result.tableOfContents).toContain('Getting Started');
      expect(result.tableOfContents).toContain('Installation');
    });

    test('passes heading filters to fetchWebPage', async () => {
      mockFetchWebPage.mockResolvedValue(createMockFetchResult({
        url: 'https://example.com/docs',
        title: 'Docs',
        markdown: '# Installation\n\nInstallation content',
        method: 'readability',
      }));

      await webFetchTool.handler({
        url: 'https://example.com/docs',
        maxChars: 10000,
        targetHeadings: ['Installation']
      });

      expect(mockFetchWebPage).toHaveBeenCalledWith(expect.objectContaining({
        headings: ['Installation']
      }));
    });

    test('passes heading index to fetchWebPage', async () => {
      mockFetchWebPage.mockResolvedValue(createMockFetchResult({
        url: 'https://example.com/docs',
        title: 'Docs',
        markdown: '# Second Heading\n\nSecond content',
        method: 'readability',
      }));

      await webFetchTool.handler({
        url: 'https://example.com/docs',
        maxChars: 10000,
        targetHeadings: [2]
      });

      expect(mockFetchWebPage).toHaveBeenCalledWith(expect.objectContaining({
        headings: [2]
      }));
    });
  });

  describe('handler - specialized extractors', () => {
    test('uses Reddit extractor for reddit.com URLs', async () => {
      mockFetchWebPage.mockResolvedValue(createMockFetchResult({
        url: 'https://www.reddit.com/r/test/comments/123',
        title: 'Reddit Post',
        markdown: '# Post Title\n\nPost content here\n\n## Comments\n\nComment 1\nComment 2',
        method: 'reddit-custom',
      }));

      const result = await webFetchTool.handler({
        url: 'https://www.reddit.com/r/test/comments/123',
        maxChars: 10000
      });

      expect(result.extractionMethod).toBe('reddit-custom');
      expect(result.markdown).toContain('Post Title');
      expect(result.markdown).toContain('Post content');
    });

    test('uses StackOverflow extractor for stackoverflow.com URLs', async () => {
      mockFetchWebPage.mockResolvedValue(createMockFetchResult({
        url: 'https://stackoverflow.com/questions/12345/test-question',
        title: 'Question Title - Stack Overflow',
        markdown: '# Question\n\nVotes: 42\n\nHow do I do X?\n\n## 2 Answers\n\n### Accepted Answer\n\nVotes: 15\n\nYou can do it this way',
        method: 'stackoverflow-custom',
      }));

      const result = await webFetchTool.handler({
        url: 'https://stackoverflow.com/questions/12345/test-question',
        maxChars: 10000
      });

      expect(result.extractionMethod).toBe('stackoverflow-custom');
      expect(result.markdown).toContain('Question');
      expect(result.markdown).toContain('How do I do X?');
    });
  });

  describe('handler - truncation and continuation', () => {
    test('indicates truncation with continuation token', async () => {
      mockFetchWebPage.mockResolvedValue(createMockFetchResult({
        url: 'https://example.com/long',
        title: 'Long Page',
        markdown: 'a'.repeat(1000),
        continuationToken: 'abc123-continuation-token',
      }));

      const result = await webFetchTool.handler({
        url: 'https://example.com/long',
        maxChars: 1000
      });

      expect(result.truncated).toBe(true);
      expect(result.continuation_token).toBe('abc123-continuation-token');
    });

    test('handles continuation token to fetch next chunk', async () => {
      // First fetch returns continuation token
      mockFetchWebPage.mockResolvedValueOnce(createMockFetchResult({
        url: 'https://example.com/long',
        title: 'Long Page',
        markdown: 'First chunk content',
        continuationToken: 'token-for-next-chunk',
      }));

      const firstResult = await webFetchTool.handler({
        url: 'https://example.com/long',
        maxChars: 5000
      });

      expect(firstResult.continuation_token).toBe('token-for-next-chunk');
      expect(firstResult.truncated).toBe(true);

      // Second fetch with continuation token
      mockFetchWebPage.mockResolvedValueOnce(createMockFetchResult({
        url: 'https://example.com/long',
        title: 'Long Page',
        markdown: 'Second chunk content',
        continuationToken: null, // No more content
      }));

      const secondResult = await webFetchTool.handler({
        continuation_token: firstResult.continuation_token,
        maxChars: 5000
      });

      expect(secondResult.url).toBe('https://example.com/long');
      expect(secondResult.title).toBe('Long Page');
      expect(secondResult.markdown).toBe('Second chunk content');
      expect(secondResult.truncated).toBe(false);
    });

    test('throws error for invalid continuation token', async () => {
      mockFetchWebPage.mockRejectedValue(new Error('Continuation token expired or invalid'));

      await expect(webFetchTool.handler({
        continuation_token: 'invalid-token-that-does-not-exist',
        maxChars: 1000
      })).rejects.toThrow('Continuation token expired or invalid');
    });

    test('does not indicate truncation for complete content', async () => {
      mockFetchWebPage.mockResolvedValue(createMockFetchResult({
        url: 'https://example.com/short',
        title: 'Short Page',
        markdown: 'Short text',
        continuationToken: null,
      }));

      const result = await webFetchTool.handler({
        url: 'https://example.com/short',
        maxChars: 10000
      });

      expect(result.truncated).toBe(false);
      expect(result.continuation_token).toBeUndefined();
    });
  });

  describe('handler - browser mode', () => {
    test('passes useBrowser option via fetchImpl when use_browser is true', async () => {
      mockFetchWebPage.mockResolvedValue(createMockFetchResult({
        url: 'https://example.com',
        title: 'Browser Fetched',
        markdown: 'Content fetched via browser',
      }));

      const result = await webFetchTool.handler({
        url: 'https://example.com',
        maxChars: 10000,
        useBrowser: true
      });

      // When useBrowser is true, fetchImpl should be provided
      expect(mockFetchWebPage).toHaveBeenCalledWith(expect.objectContaining({
        fetchImpl: expect.any(Function)
      }));
      expect(result.title).toBe('Browser Fetched');
      expect(result.markdown).toContain('Content fetched via browser');
    });

    test('throws error when browser fetch fails', async () => {
      mockFetchWebPage.mockRejectedValue(new Error('Browser timeout'));

      await expect(webFetchTool.handler({
        url: 'https://example.com',
        maxChars: 10000,
        useBrowser: true
      })).rejects.toThrow('Failed to fetch URL: Browser timeout');
    });
  });
});
