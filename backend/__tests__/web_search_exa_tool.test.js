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

  test('handler throws when Exa API key is missing', async () => {
    const args = webSearchExaTool.validate({ query: 'test' });
    await assert.rejects(() => webSearchExaTool.handler(args), /Exa API key is not configured/);
  });
});
