/**
 * Tests for webSearchExa (Exa.ai) tool
 * Covers validation, API integration, error handling, and response formatting
 */
import { describe, test, expect, jest, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { webSearchExaTool } from '../src/lib/tools/webSearchExa.js';
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

describe('webSearchExa (Exa.ai) tool', () => {
  describe('validation', () => {
    test('rejects missing query', () => {
      expect(() => webSearchExaTool.validate(null))
        .toThrow('web_search_exa requires a "query" argument of type string');
      expect(() => webSearchExaTool.validate({}))
        .toThrow('web_search_exa requires a "query" argument of type string');
      expect(() => webSearchExaTool.validate({ query: '' }))
        .toThrow('web_search_exa requires a "query" argument of type string');
      expect(() => webSearchExaTool.validate({ query: '   ' }))
        .toThrow('web_search_exa requires a "query" argument of type string');
    });

    test('accepts valid query', () => {
      const result = webSearchExaTool.validate({ query: 'test query' });
      expect(result.query).toBe('test query');
    });

    test('extracts site: domain from query', () => {
      const result = webSearchExaTool.validate({ query: 'javascript site:stackoverflow.com' });
      expect(result.query).toBe('javascript');
      expect(result.include_domains).toEqual(['stackoverflow.com']);
    });

    test('extracts site: domain with no other query', () => {
      const result = webSearchExaTool.validate({ query: 'site:example.com' });
      expect(result.query).toBe('example.com');
      expect(result.include_domains).toEqual(['example.com']);
    });

    test('extracts site: domain case-insensitively', () => {
      const result = webSearchExaTool.validate({ query: 'SITE:Example.com test query' });
      expect(result.query).toBe('test query');
      expect(result.include_domains).toEqual(['Example.com']);
    });

    test('validates type parameter', () => {
      expect(() => webSearchExaTool.validate({ query: 'test', type: 'invalid' }))
        .toThrow('type must be one of: "auto", "keyword", "neural"');

      const auto = webSearchExaTool.validate({ query: 'test', type: 'auto' });
      expect(auto.type).toBe('auto');

      const keyword = webSearchExaTool.validate({ query: 'test', type: 'keyword' });
      expect(keyword.type).toBe('keyword');

      const neural = webSearchExaTool.validate({ query: 'test', type: 'neural' });
      expect(neural.type).toBe('neural');

      // Test case insensitivity
      const upper = webSearchExaTool.validate({ query: 'test', type: 'NEURAL' });
      expect(upper.type).toBe('neural');
    });

    test('validates num_results parameter', () => {
      expect(() => webSearchExaTool.validate({ query: 'test', num_results: 0 }))
        .toThrow('num_results must be an integer between 1 and 100');
      expect(() => webSearchExaTool.validate({ query: 'test', num_results: 101 }))
        .toThrow('num_results must be an integer between 1 and 100');
      expect(() => webSearchExaTool.validate({ query: 'test', num_results: 1.5 }))
        .toThrow('num_results must be an integer between 1 and 100');
      expect(() => webSearchExaTool.validate({ query: 'test', num_results: -1 }))
        .toThrow('num_results must be an integer between 1 and 100');

      const result = webSearchExaTool.validate({ query: 'test', num_results: 10 });
      expect(result.num_results).toBe(10);

      const min = webSearchExaTool.validate({ query: 'test', num_results: 1 });
      expect(min.num_results).toBe(1);

      const max = webSearchExaTool.validate({ query: 'test', num_results: 100 });
      expect(max.num_results).toBe(100);
    });

    test('validates include_domains parameter', () => {
      expect(() => webSearchExaTool.validate({ query: 'test', include_domains: 'string' }))
        .toThrow('include_domains must be an array of non-empty strings');
      expect(() => webSearchExaTool.validate({ query: 'test', include_domains: [''] }))
        .toThrow('include_domains must be an array of non-empty strings');
      expect(() => webSearchExaTool.validate({ query: 'test', include_domains: [123] }))
        .toThrow('include_domains must be an array of non-empty strings');

      const result = webSearchExaTool.validate({
        query: 'test',
        include_domains: ['example.com', 'test.com']
      });
      expect(result.include_domains).toEqual(['example.com', 'test.com']);

      // Test trimming
      const trimmed = webSearchExaTool.validate({
        query: 'test',
        include_domains: ['  example.com  ', 'test.com']
      });
      expect(trimmed.include_domains).toEqual(['example.com', 'test.com']);
    });

    test('validates exclude_domains parameter', () => {
      expect(() => webSearchExaTool.validate({ query: 'test', exclude_domains: 'string' }))
        .toThrow('exclude_domains must be an array of non-empty strings');
      expect(() => webSearchExaTool.validate({ query: 'test', exclude_domains: [''] }))
        .toThrow('exclude_domains must be an array of non-empty strings');
      expect(() => webSearchExaTool.validate({ query: 'test', exclude_domains: [null] }))
        .toThrow('exclude_domains must be an array of non-empty strings');

      const result = webSearchExaTool.validate({
        query: 'test',
        exclude_domains: ['spam.com', 'ads.com']
      });
      expect(result.exclude_domains).toEqual(['spam.com', 'ads.com']);
    });

    test('combines site: with include_domains without duplicates', () => {
      const result = webSearchExaTool.validate({
        query: 'javascript site:stackoverflow.com',
        include_domains: ['stackoverflow.com', 'github.com']
      });
      expect(result.include_domains).toEqual(['stackoverflow.com', 'github.com']);
    });

    test('validates text parameter as boolean', () => {
      const trueResult = webSearchExaTool.validate({ query: 'test', text: true });
      expect(trueResult.text).toBe(true);

      const falseResult = webSearchExaTool.validate({ query: 'test', text: false });
      expect(falseResult.text).toBe(false);
    });

    test('validates text parameter as object', () => {
      const result = webSearchExaTool.validate({
        query: 'test',
        text: { max_characters: 1000, include_html_tags: true }
      });
      expect(result.text.maxCharacters).toBe(1000);
      expect(result.text.includeHtmlTags).toBe(true);

      // Test with only max_characters
      const maxOnly = webSearchExaTool.validate({
        query: 'test',
        text: { max_characters: 500 }
      });
      expect(maxOnly.text.maxCharacters).toBe(500);
      expect(maxOnly.text.includeHtmlTags).toBeUndefined();

      // Test with only include_html_tags
      const htmlOnly = webSearchExaTool.validate({
        query: 'test',
        text: { include_html_tags: false }
      });
      expect(htmlOnly.text.includeHtmlTags).toBe(false);
      expect(htmlOnly.text.maxCharacters).toBeUndefined();
    });

    test('rejects invalid text parameter', () => {
      expect(() => webSearchExaTool.validate({ query: 'test', text: 'string' }))
        .toThrow('text must be a boolean or an object');

      expect(() => webSearchExaTool.validate({ query: 'test', text: { max_characters: 0 } }))
        .toThrow('text.max_characters must be a positive integer');

      expect(() => webSearchExaTool.validate({ query: 'test', text: { max_characters: -1 } }))
        .toThrow('text.max_characters must be a positive integer');

      expect(() => webSearchExaTool.validate({ query: 'test', text: { max_characters: 1.5 } }))
        .toThrow('text.max_characters must be a positive integer');
    });

    test('validates highlights parameter as boolean', () => {
      const trueResult = webSearchExaTool.validate({ query: 'test', highlights: true });
      expect(trueResult.highlights).toBe(true);

      const falseResult = webSearchExaTool.validate({ query: 'test', highlights: false });
      expect(falseResult.highlights).toBe(false);
    });

    test('validates highlights parameter as object', () => {
      const result = webSearchExaTool.validate({
        query: 'test',
        highlights: {
          query: 'custom query',
          num_sentences: 3,
          highlights_per_url: 5
        }
      });
      expect(result.highlights.query).toBe('custom query');
      expect(result.highlights.numSentences).toBe(3);
      expect(result.highlights.highlightsPerUrl).toBe(5);

      // Test with trimmed query
      const trimmed = webSearchExaTool.validate({
        query: 'test',
        highlights: { query: '  trimmed  ' }
      });
      expect(trimmed.highlights.query).toBe('trimmed');
    });

    test('rejects invalid highlights parameter', () => {
      expect(() => webSearchExaTool.validate({ query: 'test', highlights: 'string' }))
        .toThrow('highlights must be a boolean or an object');

      expect(() => webSearchExaTool.validate({ query: 'test', highlights: { query: '' } }))
        .toThrow('highlights.query must be a non-empty string');

      expect(() => webSearchExaTool.validate({ query: 'test', highlights: { query: 123 } }))
        .toThrow('highlights.query must be a non-empty string');

      expect(() => webSearchExaTool.validate({ query: 'test', highlights: { num_sentences: 0 } }))
        .toThrow('highlights.num_sentences must be a positive integer');

      expect(() => webSearchExaTool.validate({ query: 'test', highlights: { num_sentences: 1.5 } }))
        .toThrow('highlights.num_sentences must be a positive integer');

      expect(() => webSearchExaTool.validate({ query: 'test', highlights: { highlights_per_url: -1 } }))
        .toThrow('highlights.highlights_per_url must be a positive integer');
    });

    test('validates summary parameter as boolean', () => {
      const trueResult = webSearchExaTool.validate({ query: 'test', summary: true });
      expect(trueResult.summary).toBe(true);

      const falseResult = webSearchExaTool.validate({ query: 'test', summary: false });
      expect(falseResult.summary).toBe(false);
    });

    test('validates summary parameter as object', () => {
      const result = webSearchExaTool.validate({
        query: 'test',
        summary: { query: 'summary query' }
      });
      expect(result.summary.query).toBe('summary query');

      // Test with trimmed query
      const trimmed = webSearchExaTool.validate({
        query: 'test',
        summary: { query: '  trimmed query  ' }
      });
      expect(trimmed.summary.query).toBe('trimmed query');
    });

    test('rejects invalid summary parameter', () => {
      expect(() => webSearchExaTool.validate({ query: 'test', summary: 'string' }))
        .toThrow('summary must be a boolean or an object');

      expect(() => webSearchExaTool.validate({ query: 'test', summary: { query: '' } }))
        .toThrow('summary.query must be a non-empty string');

      expect(() => webSearchExaTool.validate({ query: 'test', summary: { query: 123 } }))
        .toThrow('summary.query must be a non-empty string');
    });

    test('trims query whitespace', () => {
      const result = webSearchExaTool.validate({ query: '  test query  ' });
      expect(result.query).toBe('test query');
    });
  });

  describe('handler', () => {
    test('throws error when API key is not configured', async () => {
      await expect(webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Exa API key is not configured');
    });

    test('throws error when userId is missing', async () => {
      await expect(webSearchExaTool.handler(
        { query: 'test' },
        {}
      )).rejects.toThrow('Exa API key is not configured');
    });

    test('makes correct API request with minimal parameters', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'test-exa-key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Test Result',
              url: 'https://example.com/test',
              score: 0.95,
              highlights: ['Highlight 1', 'Highlight 2']
            }
          ]
        })
      });

      await webSearchExaTool.handler(
        { query: 'AI research' },
        { userId: TEST_USER_ID }
      );

      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('https://api.exa.ai/search');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['x-api-key']).toBe('test-exa-key');

      const body = JSON.parse(options.body);
      expect(body.query).toBe('AI research');
      // Default highlights should be added
      expect(body.contents).toEqual({ highlights: true });
    });

    test('makes correct API request with all parameters', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'test-exa-key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] })
      });

      // First validate the arguments (as the tool system would do)
      const validated = webSearchExaTool.validate({
        query: 'machine learning',
        type: 'neural',
        num_results: 20,
        include_domains: ['arxiv.org', 'scholar.google.com'],
        exclude_domains: ['spam.com'],
        text: { max_characters: 500, include_html_tags: false },
        highlights: { query: 'deep learning', num_sentences: 2, highlights_per_url: 3 },
        summary: { query: 'AI summary' }
      });

      // Then call handler with validated output
      await webSearchExaTool.handler(validated, { userId: TEST_USER_ID });

      const [, options] = global.fetch.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.query).toBe('machine learning');
      expect(body.type).toBe('neural');
      expect(body.numResults).toBe(20);
      expect(body.includeDomains).toEqual(['arxiv.org', 'scholar.google.com']);
      expect(body.excludeDomains).toEqual(['spam.com']);
      // The handler receives validated params with camelCase properties
      expect(body.contents.text).toEqual({ maxCharacters: 500, includeHtmlTags: false });
      expect(body.contents.highlights).toEqual({
        query: 'deep learning',
        numSentences: 2,
        highlightsPerUrl: 3
      });
      expect(body.contents.summary).toEqual({ query: 'AI summary' });
    });

    test('handles boolean text parameter', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'test-exa-key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] })
      });

      await webSearchExaTool.handler(
        { query: 'test', text: true },
        { userId: TEST_USER_ID }
      );

      const [, options] = global.fetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.contents.text).toBe(true);
    });

    test('formats results with all content types', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'test-exa-key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Research Paper',
              url: 'https://example.com/paper',
              score: 0.98,
              publishedDate: '2024-01-15',
              text: 'This is the full text content...',
              highlights: ['Important finding 1', 'Key result 2'],
              summary: 'This paper discusses AI advancements.'
            },
            {
              title: 'Blog Post',
              url: 'https://blog.example.com/ai',
              score: 0.85,
              highlights: ['Practical application']
            }
          ]
        })
      });

      const result = await webSearchExaTool.handler(
        { query: 'AI', text: true, highlights: true, summary: true },
        { userId: TEST_USER_ID }
      );

      expect(result).toContain('Search Results:');
      expect(result).toContain('1. Research Paper');
      expect(result).toContain('Text: This is the full text content...');
      expect(result).toContain('Highlights:');
      expect(result).toContain('1. Important finding 1');
      expect(result).toContain('2. Key result 2');
      expect(result).toContain('Summary: This paper discusses AI advancements.');
      expect(result).toContain('Published: 2024-01-15');
      expect(result).toContain('Relevance Score: 0.98');
      expect(result).toContain('URL: https://example.com/paper');
      expect(result).toContain('2. Blog Post');
      expect(result).toContain('Relevance Score: 0.85');
    });

    test('handles results with missing optional fields', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'test-exa-key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              url: 'https://example.com'
              // No title, text, highlights, summary, score, or publishedDate
            }
          ]
        })
      });

      const result = await webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      );

      expect(result).toContain('Search Results:');
      expect(result).toContain('1. https://example.com');
    });

    test('handles results with empty content arrays', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'test-exa-key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Empty Result',
              url: 'https://example.com',
              highlights: [],
              text: '',
              summary: ''
            }
          ]
        })
      });

      const result = await webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      );

      expect(result).toContain('1. Empty Result');
      expect(result).not.toContain('Highlights:');
      expect(result).not.toContain('Text:');
      expect(result).not.toContain('Summary:');
    });

    test('returns "No results found" for empty results array', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'test-exa-key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] })
      });

      const result = await webSearchExaTool.handler(
        { query: 'obscure query with no results' },
        { userId: TEST_USER_ID }
      );

      expect(result).toBe('No results found.');
    });

    test('returns "No results found" when results is missing', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'test-exa-key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({})
      });

      const result = await webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      );

      expect(result).toBe('No results found.');
    });

    test('handles 400 Bad Request error', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: 'Invalid search parameters' })
      });

      await expect(webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Invalid Exa request parameters: Invalid search parameters');
    });

    test('handles 401 authentication error', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'bad-key');

      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: 'Invalid API key' })
      });

      await expect(webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Exa API authentication failed: Invalid API key');
    });

    test('handles 403 forbidden error', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ error: 'Access denied' })
      });

      await expect(webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Exa API authentication failed: Access denied');
    });

    test('handles 429 rate limit error', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ message: 'Rate limit exceeded' })
      });

      await expect(webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Exa API rate limit exceeded: Rate limit exceeded');
    });

    test('handles 500 server error', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error'
      });

      await expect(webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Exa service error (500): Internal Server Error');
    });

    test('handles 503 service unavailable error', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'Service Temporarily Unavailable'
      });

      await expect(webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Exa service error (503):');
    });

    test('handles error response with plain text', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Plain text error'
      });

      await expect(webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Invalid Exa request parameters: Plain text error');
    });

    test('handles error response with empty body', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => ''
      });

      await expect(webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Invalid Exa request parameters: Unknown error');
    });

    test('handles network errors gracefully', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'key');

      const fetchError = new TypeError('Failed to fetch');
      fetchError.name = 'TypeError';
      global.fetch.mockRejectedValue(fetchError);

      await expect(webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Network error while connecting to Exa API: Failed to fetch');
    });

    test('handles JSON parsing errors', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => { throw new SyntaxError('Unexpected token'); }
      });

      await expect(webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Invalid response from Exa API: Unexpected token');
    });

    test('handles generic errors', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'key');

      global.fetch.mockRejectedValue(new Error('Something went wrong'));

      await expect(webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Exa web search failed: Something went wrong');
    });

    test('handles errors that already contain "Exa" in message', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'key');

      global.fetch.mockRejectedValue(new Error('Exa specific error'));

      await expect(webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Exa specific error');
    });

    test('handles unexpected HTTP status codes', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'key');

      global.fetch.mockResolvedValue({
        ok: false,
        status: 418, // I'm a teapot
        text: async () => JSON.stringify({ error: 'Unexpected status' })
      });

      await expect(webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      )).rejects.toThrow('Exa API request failed with status 418: Unexpected status');
    });

    test('handles special characters in query', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'test-exa-key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] })
      });

      await webSearchExaTool.handler(
        { query: 'C++ programming "best practices" & optimization' },
        { userId: TEST_USER_ID }
      );

      const [, options] = global.fetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.query).toBe('C++ programming "best practices" & optimization');
    });

    test('handles very long query', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'test-exa-key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] })
      });

      const longQuery = 'a'.repeat(1000);
      await webSearchExaTool.handler(
        { query: longQuery },
        { userId: TEST_USER_ID }
      );

      const [, options] = global.fetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.query).toBe(longQuery);
    });

    test('formats highlights with proper numbering', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'test-exa-key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Test',
              url: 'https://example.com',
              highlights: ['First highlight', 'Second highlight', 'Third highlight']
            }
          ]
        })
      });

      const result = await webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      );

      expect(result).toContain('Highlights:');
      expect(result).toContain('1. First highlight');
      expect(result).toContain('2. Second highlight');
      expect(result).toContain('3. Third highlight');
    });

    test('trims whitespace from result content', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'test-exa-key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Test',
              url: 'https://example.com',
              text: '  text with spaces  ',
              highlights: ['  highlight with spaces  '],
              summary: '  summary with spaces  '
            }
          ]
        })
      });

      const result = await webSearchExaTool.handler(
        { query: 'test', text: true, summary: true },
        { userId: TEST_USER_ID }
      );

      expect(result).toContain('Text: text with spaces');
      expect(result).toContain('1. highlight with spaces');
      expect(result).toContain('Summary: summary with spaces');
    });
  });

  describe('tool specification', () => {
    test('has correct OpenAI function specification', () => {
      expect(webSearchExaTool.spec.type).toBe('function');
      expect(webSearchExaTool.spec.function.name).toBe('web_search_exa');
      expect(webSearchExaTool.spec.function.parameters.required).toEqual(['query']);

      const props = webSearchExaTool.spec.function.parameters.properties;
      expect(props).toHaveProperty('query');
      expect(props).toHaveProperty('type');
      expect(props).toHaveProperty('num_results');
      expect(props).toHaveProperty('include_domains');
      expect(props).toHaveProperty('exclude_domains');
      expect(props).toHaveProperty('text');
      expect(props).toHaveProperty('highlights');
      expect(props).toHaveProperty('summary');
    });

    test('has correct tool metadata', () => {
      expect(webSearchExaTool.name).toBe('web_search_exa');
      expect(webSearchExaTool.description).toContain('Deep research');
      expect(webSearchExaTool.description).toContain('semantic search');
    });

    test('has correct parameter types in specification', () => {
      const props = webSearchExaTool.spec.function.parameters.properties;

      expect(props.query.type).toBe('string');
      expect(props.type.type).toBe('string');
      expect(props.type.enum).toEqual(['auto', 'keyword', 'neural']);
      expect(props.num_results.type).toBe('integer');
      expect(props.num_results.minimum).toBe(1);
      expect(props.num_results.maximum).toBe(100);
      expect(props.include_domains.type).toBe('array');
      expect(props.exclude_domains.type).toBe('array');
    });

    test('has oneOf schemas for complex parameters', () => {
      const props = webSearchExaTool.spec.function.parameters.properties;

      expect(props.text.oneOf).toBeDefined();
      expect(props.text.oneOf.length).toBe(2);
      expect(props.highlights.oneOf).toBeDefined();
      expect(props.highlights.oneOf.length).toBe(2);
      expect(props.summary.oneOf).toBeDefined();
      expect(props.summary.oneOf.length).toBe(2);
    });
  });

  describe('edge cases', () => {
    test('handles result without title or url', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'test-exa-key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              // No title or URL
              text: 'Some content'
            }
          ]
        })
      });

      const result = await webSearchExaTool.handler(
        { query: 'test', text: true },
        { userId: TEST_USER_ID }
      );

      expect(result).toContain('1. Result 1');
      expect(result).toContain('Text: Some content');
    });

    test('handles numeric score of zero', async () => {
      upsertUserSetting(TEST_USER_ID, 'exa_api_key', 'test-exa-key');

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Test',
              url: 'https://example.com',
              score: 0
            }
          ]
        })
      });

      const result = await webSearchExaTool.handler(
        { query: 'test' },
        { userId: TEST_USER_ID }
      );

      expect(result).toContain('Relevance Score: 0');
    });

    test('validates edge case num_results boundary values', () => {
      // Test exact boundary values
      const min = webSearchExaTool.validate({ query: 'test', num_results: 1 });
      expect(min.num_results).toBe(1);

      const max = webSearchExaTool.validate({ query: 'test', num_results: 100 });
      expect(max.num_results).toBe(100);

      // Test just outside boundaries
      expect(() => webSearchExaTool.validate({ query: 'test', num_results: 0 }))
        .toThrow('num_results must be an integer between 1 and 100');

      expect(() => webSearchExaTool.validate({ query: 'test', num_results: 101 }))
        .toThrow('num_results must be an integer between 1 and 100');
    });

    test('rejects empty strings in include_domains', () => {
      // Empty strings (even with spaces) are rejected during validation
      expect(() => webSearchExaTool.validate({
        query: 'test',
        include_domains: ['  ', '   ']
      })).toThrow('include_domains must be an array of non-empty strings');
    });
  });
});
