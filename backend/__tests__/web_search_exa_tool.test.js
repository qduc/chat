import assert from 'node:assert/strict';
import { webSearchExaTool } from '../src/lib/tools/webSearchExa.js';

describe('web_search_exa tool', () => {
  test('validate trims and normalizes arguments', () => {
    const validated = webSearchExaTool.validate({
      query: '  latest ai news  ',
      type: 'NEURAL',
      num_results: '5',
      use_autoprompt: 'true',
      include_domains: [' arxiv.org ', 'openreview.net'],
      exclude_domains: ['example.com '],
      start_published_date: '2024-01-01',
      end_published_date: '2024-06-30',
    });

    assert.equal(validated.query, 'latest ai news');
    assert.equal(validated.type, 'neural');
    assert.equal(validated.num_results, 5);
    assert.equal(validated.use_autoprompt, true);
    assert.deepEqual(validated.include_domains, ['arxiv.org', 'openreview.net']);
    assert.deepEqual(validated.exclude_domains, ['example.com']);
    assert.equal(validated.start_published_date, '2024-01-01');
    assert.equal(validated.end_published_date, '2024-06-30');
  });

  test('validate rejects missing query', () => {
    assert.throws(() => webSearchExaTool.validate({}), /requires a "query"/);
  });

  test('handler throws when EXA_API_KEY is missing', async () => {
    const originalKey = process.env.EXA_API_KEY;
    delete process.env.EXA_API_KEY;

    try {
      const args = webSearchExaTool.validate({ query: 'test' });
      await assert.rejects(() => webSearchExaTool.handler(args), /EXA_API_KEY environment variable is not set/);
    } finally {
      if (originalKey !== undefined) {
        process.env.EXA_API_KEY = originalKey;
      } else {
        delete process.env.EXA_API_KEY;
      }
    }
  });
});
