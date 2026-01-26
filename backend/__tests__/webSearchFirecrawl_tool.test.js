/**
 * Tests for webSearchFirecrawl tool
 * Covers validation, API integration, and error handling
 */
import { describe, test, expect, jest, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { webSearchFirecrawlTool } from '../src/lib/tools/webSearchFirecrawl.js';
import { config } from '../src/env.js';
import { getDb, resetDbCache } from '../src/db/index.js';
import { upsertUserSetting } from '../src/db/userSettings.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import { ensureTestUser, TEST_USER_ID } from './helpers/systemPromptsTestUtils.js';

// Store original fetch
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

describe('webSearchFirecrawl tool', () => {
  describe('validation', () => {
    test('rejects missing query', () => {
      expect(() => webSearchFirecrawlTool.validate(null))
        .toThrow('web_search_firecrawl requires a "query" argument of type string');
      expect(() => webSearchFirecrawlTool.validate({}))
        .toThrow('web_search_firecrawl requires a "query" argument of type string');
      expect(() => webSearchFirecrawlTool.validate({ query: '' }))
        .toThrow('web_search_firecrawl requires a "query" argument of type string');
      expect(() => webSearchFirecrawlTool.validate({ query: '  ' }))
        .toThrow('web_search_firecrawl requires a "query" argument of type string');
    });

    test('rejects invalid query type', () => {
      expect(() => webSearchFirecrawlTool.validate({ query: 123 }))
        .toThrow('web_search_firecrawl requires a "query" argument of type string');
      expect(() => webSearchFirecrawlTool.validate({ query: ['array'] }))
        .toThrow('web_search_firecrawl requires a "query" argument of type string');
    });

    test('accepts valid query and trims whitespace', () => {
      const result = webSearchFirecrawlTool.validate({ query: '  test search  ' });
      expect(result.query).toBe('test search');
    });

    test('validates page_options parameter', () => {
      // Valid object
      const result = webSearchFirecrawlTool.validate({
        query: 'test',
        page_options: { onlyMainContent: true, fetchPageContent: false }
      });
      expect(result.pageOptions).toEqual({ onlyMainContent: true, fetchPageContent: false });

      // Invalid type (not object)
      expect(() => webSearchFirecrawlTool.validate({ query: 'test', page_options: 'invalid' }))
        .toThrow('page_options must be an object');

      // Null is not valid
      expect(() => webSearchFirecrawlTool.validate({ query: 'test', page_options: null }))
        .toThrow('page_options must be an object');
    });

    test('validates search_options parameter', () => {
      // Valid object
      const result = webSearchFirecrawlTool.validate({
        query: 'test',
        search_options: { limit: 10 }
      });
      expect(result.searchOptions).toEqual({ limit: 10 });

      // Invalid type
      expect(() => webSearchFirecrawlTool.validate({ query: 'test', search_options: 'invalid' }))
        .toThrow('search_options must be an object');

      // Null is not valid
      expect(() => webSearchFirecrawlTool.validate({ query: 'test', search_options: null }))
        .toThrow('search_options must be an object');
    });

    test('handles combined valid options', () => {
      const result = webSearchFirecrawlTool.validate({
        query: 'AI news',
        page_options: { onlyMainContent: true },
        search_options: { limit: 5 }
      });
      expect(result.query).toBe('AI news');
      expect(result.pageOptions).toEqual({ onlyMainContent: true });
      expect(result.searchOptions).toEqual({ limit: 5 });
    });
  });

  describe('handler', () => {
    test('throws error when API key is not configured for cloud version', async () => {
      // No API key configured
      await expect(webSearchFirecrawlTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Firecrawl API key is not configured');
    });

    test('allows search without API key for custom base URL', async () => {
      upsertUserSetting(TEST_USER_ID, 'firecrawl_base_url', 'http://localhost:3002');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            { title: 'Result 1', url: 'https://example.com/1', description: 'Description 1' }
          ]
        })
      });

      const result = await webSearchFirecrawlTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      );

      expect(result).toContain('Result 1');
    });

    test('makes correct API request with API key', async () => {
      upsertUserSetting(TEST_USER_ID, 'firecrawl_api_key', 'test-api-key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              title: 'AI News Article',
              url: 'https://example.com/ai',
              description: 'Latest AI developments',
              markdown: 'Full article content here...'
            }
          ]
        })
      });

      const result = await webSearchFirecrawlTool.handler(
        { query: 'latest AI news', pageOptions: { onlyMainContent: true } },
        { userId: TEST_USER_ID }
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.firecrawl.dev/v1/search',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-key'
          })
        })
      );

      expect(result).toContain('AI News Article');
      expect(result).toContain('Latest AI developments');
    });

    test('uses custom base URL when configured', async () => {
      upsertUserSetting(TEST_USER_ID, 'firecrawl_api_key', 'key');
      upsertUserSetting(TEST_USER_ID, 'firecrawl_base_url', 'https://custom.firecrawl.io/');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: [] })
      });

      await webSearchFirecrawlTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      );

      // Should strip trailing slash and append /v1/search
      expect(global.fetch).toHaveBeenCalledWith(
        'https://custom.firecrawl.io/v1/search',
        expect.any(Object)
      );
    });

    test('handles API error response', async () => {
      upsertUserSetting(TEST_USER_ID, 'firecrawl_api_key', 'bad-key');

      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: 'Invalid API key' })
      });

      await expect(webSearchFirecrawlTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Firecrawl API request failed with status 401: Invalid API key');
    });

    test('handles API error with non-JSON response', async () => {
      upsertUserSetting(TEST_USER_ID, 'firecrawl_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error'
      });

      await expect(webSearchFirecrawlTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Firecrawl API request failed with status 500: Internal Server Error');
    });

    test('handles empty results', async () => {
      upsertUserSetting(TEST_USER_ID, 'firecrawl_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: [] })
      });

      const result = await webSearchFirecrawlTool.handler(
        { query: 'obscure search' },
        { userId: TEST_USER_ID }
      );

      expect(result).toBe('No results found.');
    });

    test('handles results without success flag', async () => {
      upsertUserSetting(TEST_USER_ID, 'firecrawl_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }) // No success flag
      });

      const result = await webSearchFirecrawlTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      );

      expect(result).toBe('No results found.');
    });

    test('formats results with markdown snippets', async () => {
      upsertUserSetting(TEST_USER_ID, 'firecrawl_api_key', 'key');

      const longMarkdown = 'A'.repeat(600); // Longer than 500 char limit

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              title: 'Long Article',
              url: 'https://example.com/article',
              markdown: longMarkdown
            },
            {
              url: 'https://example.com/no-title', // No title, should use URL
              description: 'Has description'
            }
          ]
        })
      });

      const result = await webSearchFirecrawlTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      );

      expect(result).toContain('Long Article');
      expect(result).toContain('Snippet:');
      expect(result).toContain('...');
      expect(result).toContain('https://example.com/no-title');
      expect(result).toContain('Has description');
    });

    test('works without user context but requires API key', async () => {
      // Without userId, can't get API key
      await expect(webSearchFirecrawlTool.handler(
        { query: 'test' },
        {}
      )).rejects.toThrow('Firecrawl API key is not configured');
    });
  });

  describe('tool specification', () => {
    test('has correct OpenAI function specification', () => {
      expect(webSearchFirecrawlTool.spec.type).toBe('function');
      expect(webSearchFirecrawlTool.spec.function.name).toBe('web_search_firecrawl');
      expect(webSearchFirecrawlTool.spec.function.parameters.properties).toHaveProperty('query');
      expect(webSearchFirecrawlTool.spec.function.parameters.properties).toHaveProperty('page_options');
      expect(webSearchFirecrawlTool.spec.function.parameters.properties).toHaveProperty('search_options');
      expect(webSearchFirecrawlTool.spec.function.parameters.required).toEqual(['query']);
    });

    test('has correct tool metadata', () => {
      expect(webSearchFirecrawlTool.name).toBe('web_search_firecrawl');
      expect(webSearchFirecrawlTool.description).toContain('Firecrawl');
    });
  });
});
