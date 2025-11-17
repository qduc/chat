import assert from 'node:assert/strict';
import { webSearchSearxngTool } from '../src/lib/tools/webSearchSearxng.js';

describe('web_search_searxng tool', () => {
  test('validate trims and normalizes arguments', () => {
    const validated = webSearchSearxngTool.validate({
      query: '  latest ai news  ',
      categories: ' general,news ',
      engines: ' google,duckduckgo ',
      language: ' en ',
      pageno: '2',
      time_range: 'week',
      safesearch: '1',
      max_results: '20',
    });

    assert.equal(validated.query, 'latest ai news');
    assert.equal(validated.categories, 'general,news');
    assert.equal(validated.engines, 'google,duckduckgo');
    assert.equal(validated.language, 'en');
    assert.equal(validated.pageno, 2);
    assert.equal(validated.time_range, 'week');
    assert.equal(validated.safesearch, 1);
    assert.equal(validated.max_results, 20);
  });

  test('validate rejects missing query', () => {
    assert.throws(() => webSearchSearxngTool.validate({}), /requires a "query"/);
  });

  test('validate rejects empty query', () => {
    assert.throws(() => webSearchSearxngTool.validate({ query: '   ' }), /requires a "query"/);
  });

  test('validate rejects invalid time_range', () => {
    assert.throws(
      () => webSearchSearxngTool.validate({ query: 'test', time_range: 'invalid' }),
      /time_range must be one of/
    );
  });

  test('validate rejects invalid safesearch value', () => {
    assert.throws(
      () => webSearchSearxngTool.validate({ query: 'test', safesearch: 5 }),
      /safesearch must be an integer between 0 and 2/
    );
  });

  test('validate rejects invalid pageno', () => {
    assert.throws(
      () => webSearchSearxngTool.validate({ query: 'test', pageno: 0 }),
      /pageno must be a positive integer/
    );
  });

  test('validate rejects invalid max_results', () => {
    assert.throws(
      () => webSearchSearxngTool.validate({ query: 'test', max_results: 100 }),
      /max_results must be an integer between 1 and 50/
    );
  });

  test('validate accepts valid time_range values', () => {
    const timeRanges = ['day', 'week', 'month', 'year'];
    for (const timeRange of timeRanges) {
      const validated = webSearchSearxngTool.validate({ query: 'test', time_range: timeRange });
      assert.equal(validated.time_range, timeRange);
    }
  });

  test('validate accepts valid safesearch values', () => {
    for (let i = 0; i <= 2; i++) {
      const validated = webSearchSearxngTool.validate({ query: 'test', safesearch: i });
      assert.equal(validated.safesearch, i);
    }
  });

  test('handler throws when SearXNG base URL is not configured', async () => {
    const originalUrl = process.env.SEARXNG_BASE_URL;
    delete process.env.SEARXNG_BASE_URL;

    try {
      const args = webSearchSearxngTool.validate({ query: 'test' });
      await assert.rejects(() => webSearchSearxngTool.handler(args), /SearXNG base URL is not configured/);
    } finally {
      if (originalUrl !== undefined) {
        process.env.SEARXNG_BASE_URL = originalUrl;
      } else {
        delete process.env.SEARXNG_BASE_URL;
      }
    }
  });

  test('validate handles optional parameters correctly', () => {
    const validated = webSearchSearxngTool.validate({ query: 'test' });
    assert.equal(validated.query, 'test');
    assert.equal(validated.categories, undefined);
    assert.equal(validated.engines, undefined);
    assert.equal(validated.language, undefined);
    assert.equal(validated.pageno, undefined);
    assert.equal(validated.time_range, undefined);
    assert.equal(validated.safesearch, undefined);
    assert.equal(validated.max_results, undefined);
  });

  test('validate rejects empty string for categories', () => {
    assert.throws(
      () => webSearchSearxngTool.validate({ query: 'test', categories: '   ' }),
      /categories must be a non-empty string/
    );
  });

  test('validate rejects empty string for engines', () => {
    assert.throws(
      () => webSearchSearxngTool.validate({ query: 'test', engines: '   ' }),
      /engines must be a non-empty string/
    );
  });

  test('validate rejects empty string for language', () => {
    assert.throws(
      () => webSearchSearxngTool.validate({ query: 'test', language: '   ' }),
      /language must be a non-empty string/
    );
  });
});
