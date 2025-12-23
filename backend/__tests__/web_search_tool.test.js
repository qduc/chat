import assert from 'node:assert/strict';
import { webSearchTool } from '../src/lib/tools/webSearch.js';

describe('web_search tool (Tavily)', () => {
  test('validate trims and normalizes arguments', () => {
    const validated = webSearchTool.validate({
      query: '  latest ai news  ',
      search_depth: 'advanced',
      max_results: '5',
      include_domains: [' wikipedia.org ', 'github.com'],
      exclude_domains: ['spam.com '],
    });

    assert.equal(validated.query, 'latest ai news');
    assert.equal(validated.search_depth, 'advanced');
    assert.equal(validated.max_results, 5);
    assert.deepEqual(validated.include_domains, ['wikipedia.org', 'github.com']);
    assert.deepEqual(validated.exclude_domains, ['spam.com']);
  });

  test('validate extracts site:domain from query', () => {
    const validated = webSearchTool.validate({
      query: 'latest news site:example.com',
      include_domains: ['cnn.com']
    });

    assert.equal(validated.query, 'latest news');
    assert.deepEqual(validated.include_domains, ['example.com', 'cnn.com']);
  });

  test('validate handles query with only site:domain', () => {
    const validated = webSearchTool.validate({
      query: 'site:example.com'
    });

    assert.equal(validated.query, 'example.com');
    assert.deepEqual(validated.include_domains, ['example.com']);
  });

  test('validate rejects missing query', () => {
    assert.throws(() => webSearchTool.validate({}), /requires a "query"/);
  });

  test('handler throws when Tavily API key is missing', async () => {
    const args = webSearchTool.validate({ query: 'test' });
    await assert.rejects(() => webSearchTool.handler(args), /Tavily API key is not configured/);
  });
});
