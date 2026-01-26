/**
 * Enhanced tests for webSearchSearxng tool
 * Covers API integration, response formatting, and error handling
 */
import { describe, test, expect, jest, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { webSearchSearxngTool } from '../src/lib/tools/webSearchSearxng.js';
import { config } from '../src/env.js';
import { getDb, resetDbCache } from '../src/db/index.js';
import { upsertUserSetting } from '../src/db/userSettings.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import { ensureTestUser, TEST_USER_ID } from './helpers/systemPromptsTestUtils.js';

const originalFetch = global.fetch;

beforeAll(() => {
  safeTestSetup();
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  getDb();
  ensureTestUser();
});

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(TEST_USER_ID);
  ensureTestUser();
  // Reset fetch mock
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

afterAll(() => {
  resetDbCache();
});

describe('webSearchSearxng tool - handler', () => {
  test('throws error when base URL is not configured', async () => {
    await expect(webSearchSearxngTool.handler(
      { query: 'test' },
      { userId: TEST_USER_ID }
    )).rejects.toThrow('SearXNG base URL is not configured');
  });

  test('validates base URL format', async () => {
    upsertUserSetting(TEST_USER_ID, 'searxng_base_url', 'not-a-valid-url');

    await expect(webSearchSearxngTool.handler(
      { query: 'test' },
      { userId: TEST_USER_ID }
    )).rejects.toThrow('Invalid SearXNG base URL');
  });

  test('validates base URL protocol', async () => {
    upsertUserSetting(TEST_USER_ID, 'searxng_base_url', 'ftp://searxng.local');

    await expect(webSearchSearxngTool.handler(
      { query: 'test' },
      { userId: TEST_USER_ID }
    )).rejects.toThrow('must start with http:// or https://');
  });

  test('makes correct API request with all parameters', async () => {
    upsertUserSetting(TEST_USER_ID, 'searxng_base_url', 'https://searxng.local');

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ query: 'test', results: [] })
    });

    await webSearchSearxngTool.handler({
      query: 'AI news',
      engines: 'google,duckduckgo',
      language: 'en',
      pageno: 2,
      time_range: 'week',
      safesearch: 1,
      max_results: 15
    }, { userId: TEST_USER_ID });

    const [url] = global.fetch.mock.calls[0];
    const parsedUrl = new URL(url);

    expect(parsedUrl.origin).toBe('https://searxng.local');
    expect(parsedUrl.pathname).toBe('/search');
    expect(parsedUrl.searchParams.get('q')).toBe('AI news');
    expect(parsedUrl.searchParams.get('format')).toBe('json');
    expect(parsedUrl.searchParams.get('engines')).toBe('google,duckduckgo');
    expect(parsedUrl.searchParams.get('language')).toBe('en');
    expect(parsedUrl.searchParams.get('pageno')).toBe('2');
    expect(parsedUrl.searchParams.get('time_range')).toBe('week');
    expect(parsedUrl.searchParams.get('safesearch')).toBe('1');
  });

  test('formats search results correctly', async () => {
    upsertUserSetting(TEST_USER_ID, 'searxng_base_url', 'https://searxng.local');

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        query: 'test query',
        results: [
          {
            title: 'First Result',
            content: 'This is the snippet for the first result.',
            url: 'https://example.com/1',
            engine: 'google',
            publishedDate: '2024-01-15'
          },
          {
            title: 'Second Result',
            content: 'Another snippet here.',
            url: 'https://example.com/2',
            engine: 'duckduckgo'
          }
        ]
      })
    });

    const result = await webSearchSearxngTool.handler(
      { query: 'test query', max_results: 10 },
      { userId: TEST_USER_ID }
    );

    expect(result).toContain('Query: test query');
    expect(result).toContain('Number of results: 2');
    expect(result).toContain('First Result');
    expect(result).toContain('This is the snippet');
    expect(result).toContain('URL: https://example.com/1');
    expect(result).toContain('Source: google');
    expect(result).toContain('Published: 2024-01-15');
    expect(result).toContain('Second Result');
  });

  test('truncates long snippets', async () => {
    upsertUserSetting(TEST_USER_ID, 'searxng_base_url', 'https://searxng.local');

    const longContent = 'A'.repeat(1000);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ title: 'Long', content: longContent, url: 'https://example.com' }]
      })
    });

    const result = await webSearchSearxngTool.handler(
      { query: 'test' },
      { userId: TEST_USER_ID }
    );

    // Content should be truncated to 800 chars with ellipsis
    expect(result).toContain('…');
    expect(result.length).toBeLessThan(longContent.length + 200);
  });

  test('respects max_results limit', async () => {
    upsertUserSetting(TEST_USER_ID, 'searxng_base_url', 'https://searxng.local');

    const results = Array.from({ length: 20 }, (_, i) => ({
      title: `Result ${i + 1}`,
      url: `https://example.com/${i + 1}`
    }));

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results })
    });

    const result = await webSearchSearxngTool.handler(
      { query: 'test', max_results: 5 },
      { userId: TEST_USER_ID }
    );

    expect(result).toContain('Result 1');
    expect(result).toContain('Result 5');
    expect(result).not.toContain('Result 6');
    expect(result).toContain('... and 15 more results');
  });

  test('includes suggestions when available', async () => {
    upsertUserSetting(TEST_USER_ID, 'searxng_base_url', 'https://searxng.local');

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ title: 'Result', url: 'https://example.com' }],
        suggestions: ['suggestion 1', 'suggestion 2']
      })
    });

    const result = await webSearchSearxngTool.handler(
      { query: 'test' },
      { userId: TEST_USER_ID }
    );

    expect(result).toContain('Suggestions:');
    expect(result).toContain('suggestion 1');
    expect(result).toContain('suggestion 2');
  });

  test('includes corrections when available', async () => {
    upsertUserSetting(TEST_USER_ID, 'searxng_base_url', 'https://searxng.local');

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
        corrections: ['did you mean this']
      })
    });

    const result = await webSearchSearxngTool.handler(
      { query: 'tset' },
      { userId: TEST_USER_ID }
    );

    expect(result).toContain('Did you mean:');
    expect(result).toContain('did you mean this');
  });

  test('includes infoboxes when available', async () => {
    upsertUserSetting(TEST_USER_ID, 'searxng_base_url', 'https://searxng.local');

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
        infoboxes: [
          {
            infobox: 'Python (programming language)',
            content: 'Python is a high-level programming language.',
            urls: ['https://python.org', 'https://wikipedia.org/wiki/Python']
          }
        ]
      })
    });

    const result = await webSearchSearxngTool.handler(
      { query: 'python' },
      { userId: TEST_USER_ID }
    );

    expect(result).toContain('Additional Information:');
    expect(result).toContain('Python (programming language)');
    expect(result).toContain('high-level programming language');
    expect(result).toContain('URLs:');
  });

  test('handles empty results', async () => {
    upsertUserSetting(TEST_USER_ID, 'searxng_base_url', 'https://searxng.local');

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] })
    });

    const result = await webSearchSearxngTool.handler(
      { query: 'very obscure query' },
      { userId: TEST_USER_ID }
    );

    expect(result).toContain('No results found');
  });

  test('handles 400 Bad Request error', async () => {
    upsertUserSetting(TEST_USER_ID, 'searxng_base_url', 'https://searxng.local');

    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'Bad query' })
    });

    await expect(webSearchSearxngTool.handler(
      { query: 'test' },
      { userId: TEST_USER_ID }
    )).rejects.toThrow('Invalid request parameters: Bad query');
  });

  test('handles 404 Not Found error', async () => {
    upsertUserSetting(TEST_USER_ID, 'searxng_base_url', 'https://searxng.local');

    global.fetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found'
    });

    await expect(webSearchSearxngTool.handler(
      { query: 'test' },
      { userId: TEST_USER_ID }
    )).rejects.toThrow('SearXNG API endpoint not found');
  });

  test('handles 500 server error', async () => {
    upsertUserSetting(TEST_USER_ID, 'searxng_base_url', 'https://searxng.local');

    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    });

    await expect(webSearchSearxngTool.handler(
      { query: 'test' },
      { userId: TEST_USER_ID }
    )).rejects.toThrow('SearXNG service error (500)');
  });

  test('handles timeout error', async () => {
    upsertUserSetting(TEST_USER_ID, 'searxng_base_url', 'https://searxng.local');

    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    global.fetch.mockRejectedValue(abortError);

    await expect(webSearchSearxngTool.handler(
      { query: 'test' },
      { userId: TEST_USER_ID }
    )).rejects.toThrow('Request timeout: SearXNG took too long to respond');
  });

  test('handles network errors', async () => {
    upsertUserSetting(TEST_USER_ID, 'searxng_base_url', 'https://searxng.local');

    const fetchError = new TypeError('Failed to fetch');
    global.fetch.mockRejectedValue(fetchError);

    await expect(webSearchSearxngTool.handler(
      { query: 'test' },
      { userId: TEST_USER_ID }
    )).rejects.toThrow('Network error while connecting to SearXNG');
  });

  test('handles JSON parsing errors', async () => {
    upsertUserSetting(TEST_USER_ID, 'searxng_base_url', 'https://searxng.local');

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError('Invalid JSON'); }
    });

    await expect(webSearchSearxngTool.handler(
      { query: 'test' },
      { userId: TEST_USER_ID }
    )).rejects.toThrow('Invalid response from SearXNG');
  });

  test('handles null or undefined result fields gracefully', async () => {
    upsertUserSetting(TEST_USER_ID, 'searxng_base_url', 'https://searxng.local');

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { title: null, url: 'https://example.com' }, // Missing title
          { url: null }, // Missing URL
          {} // Empty object
        ]
      })
    });

    const result = await webSearchSearxngTool.handler(
      { query: 'test' },
      { userId: TEST_USER_ID }
    );

    // Should not throw, should handle gracefully
    expect(result).toContain('Untitled');
    expect(result).toContain('N/A');
  });
});

describe('webSearchSearxng tool - specification', () => {
  test('has correct OpenAI function specification', () => {
    expect(webSearchSearxngTool.spec.type).toBe('function');
    expect(webSearchSearxngTool.spec.function.name).toBe('web_search_searxng');
    expect(webSearchSearxngTool.spec.function.parameters.required).toEqual(['query']);

    const props = webSearchSearxngTool.spec.function.parameters.properties;
    expect(props).toHaveProperty('query');
    expect(props).toHaveProperty('time_range');
    expect(props).toHaveProperty('max_results');
    expect(props.time_range.enum).toEqual(['day', 'week', 'month', 'year']);
  });

  test('has correct tool metadata', () => {
    expect(webSearchSearxngTool.name).toBe('web_search_searxng');
    expect(webSearchSearxngTool.description).toContain('SearXNG');
  });
});
