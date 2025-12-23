import assert from 'node:assert/strict';
import { webSearchExaTool } from '../src/lib/tools/webSearchExa.js';

describe('web_search_exa tool', () => {
  test('validate trims and normalizes arguments', () => {
    const validated = webSearchExaTool.validate({
      query: '  latest ai news  ',
      type: 'NEURAL',
      num_results: '5',
      include_domains: [' arxiv.org ', 'openreview.net'],
      exclude_domains: ['example.com '],
    });

    assert.equal(validated.query, 'latest ai news');
    assert.equal(validated.type, 'neural');
    assert.equal(validated.num_results, 5);
    assert.deepEqual(validated.include_domains, ['arxiv.org', 'openreview.net']);
    assert.deepEqual(validated.exclude_domains, ['example.com']);
  });

  test('validate rejects missing query', () => {
    assert.throws(() => webSearchExaTool.validate({}), /requires a "query"/);
  });

  test('validate extracts site:domain from query', () => {
    const validated = webSearchExaTool.validate({
      query: 'latest news site:example.com',
      include_domains: ['cnn.com']
    });

    assert.equal(validated.query, 'latest news');
    assert.deepEqual(validated.include_domains, ['example.com', 'cnn.com']);
  });

  test('validate handles query with only site:domain', () => {
    const validated = webSearchExaTool.validate({
      query: 'site:example.com'
    });

    assert.equal(validated.query, 'example.com');
    assert.deepEqual(validated.include_domains, ['example.com']);
  });

  test('handler throws when Exa API key is missing', async () => {
    const args = webSearchExaTool.validate({ query: 'test' });
    await assert.rejects(() => webSearchExaTool.handler(args), /Exa API key is not configured/);
  });
});
