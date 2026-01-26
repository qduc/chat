/**
 * Tests for webSearch (Tavily) tool
 * Covers validation, API integration, error handling, and response formatting
 */
import { describe, test, expect, jest, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { webSearchTool } from '../src/lib/tools/webSearch.js';
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

describe('webSearch (Tavily) tool', () => {
  describe('validation', () => {
    test('rejects missing query', () => {
      expect(() => webSearchTool.validate(null))
        .toThrow('web_search requires a "query" argument of type string');
      expect(() => webSearchTool.validate({}))
        .toThrow('web_search requires a "query" argument of type string');
      expect(() => webSearchTool.validate({ query: '' }))
        .toThrow('web_search requires a "query" argument of type string');
    });

    test('extracts site: domain from query', () => {
      const result = webSearchTool.validate({ query: 'javascript site:stackoverflow.com' });
      expect(result.query).toBe('javascript');
      expect(result.include_domains).toEqual(['stackoverflow.com']);
    });

    test('extracts site: domain with no other query', () => {
      const result = webSearchTool.validate({ query: 'site:example.com' });
      expect(result.query).toBe('example.com');
      expect(result.include_domains).toEqual(['example.com']);
    });

    test('validates search_depth parameter', () => {
      expect(() => webSearchTool.validate({ query: 'test', search_depth: 'invalid' }))
        .toThrow('search_depth must be either "basic" or "advanced"');

      const basic = webSearchTool.validate({ query: 'test', search_depth: 'basic' });
      expect(basic.search_depth).toBe('basic');

      const advanced = webSearchTool.validate({ query: 'test', search_depth: 'advanced' });
      expect(advanced.search_depth).toBe('advanced');
    });

    test('validates topic parameter', () => {
      expect(() => webSearchTool.validate({ query: 'test', topic: 'invalid' }))
        .toThrow('topic must be one of: "general", "news", "finance"');

      const news = webSearchTool.validate({ query: 'test', topic: 'news' });
      expect(news.topic).toBe('news');
    });

    test('validates days parameter', () => {
      expect(() => webSearchTool.validate({ query: 'test', days: 0 }))
        .toThrow('days must be a positive integer');
      expect(() => webSearchTool.validate({ query: 'test', days: -1 }))
        .toThrow('days must be a positive integer');
      expect(() => webSearchTool.validate({ query: 'test', days: 1.5 }))
        .toThrow('days must be a positive integer');

      const result = webSearchTool.validate({ query: 'test', days: 7 });
      expect(result.days).toBe(7);
    });

    test('validates max_results parameter', () => {
      expect(() => webSearchTool.validate({ query: 'test', max_results: 0 }))
        .toThrow('max_results must be an integer between 1 and 20');
      expect(() => webSearchTool.validate({ query: 'test', max_results: 21 }))
        .toThrow('max_results must be an integer between 1 and 20');

      const result = webSearchTool.validate({ query: 'test', max_results: 10 });
      expect(result.max_results).toBe(10);
    });

    test('validates include_answer parameter', () => {
      // Boolean true -> 'basic'
      let result = webSearchTool.validate({ query: 'test', include_answer: true });
      expect(result.include_answer).toBe('basic');

      // Boolean false -> false
      result = webSearchTool.validate({ query: 'test', include_answer: false });
      expect(result.include_answer).toBe(false);

      // String values
      result = webSearchTool.validate({ query: 'test', include_answer: 'advanced' });
      expect(result.include_answer).toBe('advanced');

      // Invalid value
      expect(() => webSearchTool.validate({ query: 'test', include_answer: 'invalid' }))
        .toThrow('include_answer must be a boolean or one of: "basic", "advanced"');
    });

    test('validates include_raw_content parameter', () => {
      // Boolean
      let result = webSearchTool.validate({ query: 'test', include_raw_content: true });
      expect(result.include_raw_content).toBe(true);

      // String values
      result = webSearchTool.validate({ query: 'test', include_raw_content: 'markdown' });
      expect(result.include_raw_content).toBe('markdown');

      result = webSearchTool.validate({ query: 'test', include_raw_content: 'text' });
      expect(result.include_raw_content).toBe('text');

      // Invalid
      expect(() => webSearchTool.validate({ query: 'test', include_raw_content: 'html' }))
        .toThrow('include_raw_content must be a boolean or one of: "markdown", "text"');
    });

    test('validates include_images parameter', () => {
      const result = webSearchTool.validate({ query: 'test', include_images: 'yes' }); // Truthy
      expect(result.include_images).toBe(true);
    });

    test('validates include_domains parameter', () => {
      expect(() => webSearchTool.validate({ query: 'test', include_domains: 'string' }))
        .toThrow('include_domains must be an array of domain strings');

      const result = webSearchTool.validate({
        query: 'test',
        include_domains: ['example.com', 'test.com']
      });
      expect(result.include_domains).toEqual(['example.com', 'test.com']);
    });

    test('validates exclude_domains parameter', () => {
      expect(() => webSearchTool.validate({ query: 'test', exclude_domains: 'string' }))
        .toThrow('exclude_domains must be an array of domain strings');

      const result = webSearchTool.validate({
        query: 'test',
        exclude_domains: ['spam.com']
      });
      expect(result.exclude_domains).toEqual(['spam.com']);
    });

    test('validates time_range parameter', () => {
      const validRanges = ['day', 'week', 'month', 'year', 'd', 'w', 'm', 'y'];
      for (const range of validRanges) {
        const result = webSearchTool.validate({ query: 'test', time_range: range });
        expect(result.time_range).toBe(range);
      }

      expect(() => webSearchTool.validate({ query: 'test', time_range: 'hour' }))
        .toThrow('time_range must be one of');
    });

    test('validates start_date parameter', () => {
      expect(() => webSearchTool.validate({ query: 'test', start_date: '2024-1-1' }))
        .toThrow('start_date must be in YYYY-MM-DD format');

      const result = webSearchTool.validate({ query: 'test', start_date: '2024-01-01' });
      expect(result.start_date).toBe('2024-01-01');
    });

    test('validates end_date parameter', () => {
      expect(() => webSearchTool.validate({ query: 'test', end_date: 'Jan 1 2024' }))
        .toThrow('end_date must be in YYYY-MM-DD format');

      const result = webSearchTool.validate({ query: 'test', end_date: '2024-12-31' });
      expect(result.end_date).toBe('2024-12-31');
    });

    test('combines site: with include_domains without duplicates', () => {
      const result = webSearchTool.validate({
        query: 'javascript site:stackoverflow.com',
        include_domains: ['stackoverflow.com', 'github.com']
      });
      expect(result.include_domains).toEqual(['stackoverflow.com', 'github.com']);
    });
  });

  describe('handler', () => {
    test('throws error when API key is not configured', async () => {
      await expect(webSearchTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Tavily API key is not configured');
    });

    test('makes correct API request with all parameters', async () => {
      upsertUserSetting(TEST_USER_ID, 'tavily_api_key', 'test-tavily-key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            { title: 'Result 1', content: 'Content 1', url: 'https://example.com/1', score: 0.95 }
          ]
        })
      });

      await webSearchTool.handler({
        query: 'AI news',
        search_depth: 'advanced',
        topic: 'news',
        days: 7,
        max_results: 5,
        include_answer: 'basic'
      }, { userId: TEST_USER_ID });

      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('https://api.tavily.com/search');
      const body = JSON.parse(options.body);
      expect(body.api_key).toBe('test-tavily-key');
      expect(body.query).toBe('AI news');
      expect(body.search_depth).toBe('advanced');
      expect(body.topic).toBe('news');
      expect(body.days).toBe(7);
      expect(body.max_results).toBe(5);
      expect(body.include_answer).toBe('basic');
    });

    test('handles 400 Bad Request error', async () => {
      upsertUserSetting(TEST_USER_ID, 'tavily_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: 'Invalid parameters' })
      });

      await expect(webSearchTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Invalid request parameters');
    });

    test('handles 401 authentication error', async () => {
      upsertUserSetting(TEST_USER_ID, 'tavily_api_key', 'bad-key');

      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: 'Invalid API key' })
      });

      await expect(webSearchTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Tavily API authentication failed');
    });

    test('handles 429 rate limit error', async () => {
      upsertUserSetting(TEST_USER_ID, 'tavily_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ message: 'Rate limit exceeded' })
      });

      await expect(webSearchTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Tavily API rate limit exceeded');
    });

    test('handles 500+ server errors', async () => {
      upsertUserSetting(TEST_USER_ID, 'tavily_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable'
      });

      await expect(webSearchTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Tavily service error (503)');
    });

    test('formats results with answer and images', async () => {
      upsertUserSetting(TEST_USER_ID, 'tavily_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          answer: 'AI is the simulation of human intelligence by machines.',
          images: [
            'https://example.com/ai.jpg',
            { url: 'https://example.com/ml.png', description: 'ML diagram' }
          ],
          results: [
            {
              title: 'What is AI?',
              content: 'Artificial intelligence is...',
              url: 'https://example.com/ai',
              score: 0.98
            }
          ]
        })
      });

      const result = await webSearchTool.handler(
        { query: 'what is AI', include_images: true },
        { userId: TEST_USER_ID }
      );

      expect(result).toContain('Answer: AI is the simulation');
      expect(result).toContain('Images:');
      expect(result).toContain('https://example.com/ai.jpg');
      expect(result).toContain('ML diagram');
      expect(result).toContain('What is AI?');
      expect(result).toContain('Relevance Score: 0.98');
    });

    test('includes raw_content when requested', async () => {
      upsertUserSetting(TEST_USER_ID, 'tavily_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Article',
              content: 'Summary',
              url: 'https://example.com',
              raw_content: 'Full article text...'
            }
          ]
        })
      });

      const result = await webSearchTool.handler(
        { query: 'test', include_raw_content: true },
        { userId: TEST_USER_ID }
      );

      expect(result).toContain('Raw Content: Full article text');
    });

    test('returns "No results found" for empty results', async () => {
      upsertUserSetting(TEST_USER_ID, 'tavily_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] })
      });

      const result = await webSearchTool.handler(
        { query: 'obscure query with no results' },
        { userId: TEST_USER_ID }
      );

      expect(result).toBe('No results found.');
    });

    test('handles network errors gracefully', async () => {
      upsertUserSetting(TEST_USER_ID, 'tavily_api_key', 'key');

      const fetchError = new TypeError('Failed to fetch');
      fetchError.name = 'TypeError';
      global.fetch.mockRejectedValue(fetchError);

      await expect(webSearchTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Network error while connecting to Tavily API');
    });

    test('handles JSON parsing errors', async () => {
      upsertUserSetting(TEST_USER_ID, 'tavily_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => { throw new SyntaxError('Unexpected token'); }
      });

      await expect(webSearchTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Invalid response from Tavily API');
    });
  });

  describe('tool specification', () => {
    test('has correct OpenAI function specification', () => {
      expect(webSearchTool.spec.type).toBe('function');
      expect(webSearchTool.spec.function.name).toBe('web_search');
      expect(webSearchTool.spec.function.parameters.required).toEqual(['query']);

      const props = webSearchTool.spec.function.parameters.properties;
      expect(props).toHaveProperty('query');
      expect(props).toHaveProperty('search_depth');
      expect(props).toHaveProperty('days');
      expect(props).toHaveProperty('time_range');
      expect(props).toHaveProperty('max_results');
      expect(props).toHaveProperty('include_answer');
      expect(props).toHaveProperty('include_domains');
      expect(props).toHaveProperty('exclude_domains');
    });

    test('has correct tool metadata', () => {
      expect(webSearchTool.name).toBe('web_search');
      expect(webSearchTool.description).toContain('search');
    });
  });
});
