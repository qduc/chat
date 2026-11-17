import assert from 'node:assert/strict';
import { normalizeUsage, extractUsage } from '../src/lib/utils/usage.js';

describe('usage normalization', () => {
  test('normalizes OpenAI chat completions usage', () => {
    const usage = normalizeUsage({
      prompt_tokens: 12,
      completion_tokens: 34,
      total_tokens: 46,
    });

    assert.deepEqual(usage, {
      prompt_tokens: 12,
      completion_tokens: 34,
      total_tokens: 46,
    });
  });

  test('normalizes Responses API usage', () => {
    const usage = normalizeUsage({
      input_tokens: 7,
      output_tokens: 9,
      total_tokens: 16,
      output_tokens_details: { reasoning_tokens: 3 },
    });

    assert.deepEqual(usage, {
      prompt_tokens: 7,
      completion_tokens: 9,
      total_tokens: 16,
      reasoning_tokens: 3,
    });
  });

  test('normalizes Anthropic usage', () => {
    const usage = normalizeUsage({
      input_tokens: 5,
      output_tokens: 11,
    });

    assert.deepEqual(usage, {
      prompt_tokens: 5,
      completion_tokens: 11,
      total_tokens: 16,
    });
  });

  test('normalizes Gemini usage metadata', () => {
    const usage = normalizeUsage({
      promptTokenCount: 8,
      candidatesTokenCount: 10,
      totalTokenCount: 18,
    });

    assert.deepEqual(usage, {
      prompt_tokens: 8,
      completion_tokens: 10,
      total_tokens: 18,
    });
  });

  test('extracts usage from nested response payloads', () => {
    const usage = extractUsage({
      response: {
        usage: { input_tokens: 4, output_tokens: 6, total_tokens: 10 },
      },
    });

    assert.deepEqual(usage, {
      prompt_tokens: 4,
      completion_tokens: 6,
      total_tokens: 10,
    });
  });

  test('extracts usage and timings from payload with both', () => {
    const payload = {
      usage: {
        completion_tokens: 101,
        prompt_tokens: 12,
        total_tokens: 113,
      },
      id: 'chatcmpl-b8po4GClGGYKPgeeVyuTjNwKBJbnWnjQ',
      timings: {
        cache_n: 0,
        prompt_n: 12,
        prompt_ms: 124.152,
        prompt_per_token_ms: 10.346,
        prompt_per_second: 96.65571235260003,
        predicted_n: 101,
        predicted_ms: 2288.937,
        predicted_per_token_ms: 22.662742574257425,
        predicted_per_second: 44.12528610442315,
      },
    };

    const usage = extractUsage(payload);

    assert.deepEqual(usage, {
      prompt_tokens: 12,
      completion_tokens: 101,
      total_tokens: 113,
      prompt_ms: 124.152,
      completion_ms: 2288.937,
    });
  });

  test('extracts usage from timings ONLY', () => {
    const payload = {
      timings: {
        prompt_n: 15,
        predicted_n: 25,
        prompt_ms: 100,
        predicted_ms: 500,
      },
    };

    const usage = extractUsage(payload);

    assert.deepEqual(usage, {
      prompt_tokens: 15,
      completion_tokens: 25,
      total_tokens: 40,
      prompt_ms: 100,
      completion_ms: 500,
    });
  });

  test('sums cache_n and prompt_n from timings', () => {
    const payload = {
      timings: {
        cache_n: 10,
        prompt_n: 5,
        predicted_n: 20,
      },
    };

    const usage = extractUsage(payload);

    assert.deepEqual(usage, {
      prompt_tokens: 15,
      completion_tokens: 20,
      total_tokens: 35,
    });
  });

  test('native Anthropic: prompt_tokens adds cache reads and writes back to input_tokens', () => {
    const usage = normalizeUsage({
      input_tokens: 30,
      cache_read_input_tokens: 25,
      cache_creation_input_tokens: 5,
      output_tokens: 15,
    });

    assert.deepEqual(usage, {
      prompt_tokens: 60,
      completion_tokens: 15,
      total_tokens: 75,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 25,
    });
  });

  test('normalization is idempotent', () => {
    const raw = [
      { input_tokens: 30, cache_read_input_tokens: 25, output_tokens: 15 },
      { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 }, cost: 0.001 },
      { input_tokens: 50, output_tokens: 5, input_tokens_details: { cached_tokens: 20 } },
    ];
    for (const entry of raw) {
      const once = normalizeUsage(entry);
      assert.deepEqual(normalizeUsage(once), once);
    }
  });

  test('OpenRouter: cache reads/writes from prompt_tokens_details and reported cost', () => {
    const usage = normalizeUsage({
      prompt_tokens: 100,
      completion_tokens: 5,
      total_tokens: 105,
      prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 },
      cost: 0.00123,
      cost_details: { upstream_inference_cost: 0.0012 },
    });

    assert.deepEqual(usage, {
      prompt_tokens: 100,
      completion_tokens: 5,
      total_tokens: 105,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 40,
      provider_cost_usd: 0.00123,
    });
  });

  test('OpenRouter BYOK: cost is the fee plus the upstream charge', () => {
    const usage = normalizeUsage({
      prompt_tokens: 10,
      completion_tokens: 2,
      is_byok: true,
      cost: 0,
      cost_details: { upstream_inference_cost: 0.004 },
    });
    assert.equal(usage.provider_cost_usd, 0.004);

    const withoutUpstream = normalizeUsage({ prompt_tokens: 10, completion_tokens: 2, is_byok: true, cost: 0 });
    assert.equal(withoutUpstream.provider_cost_usd, undefined);
  });

  test('Responses API: input_tokens_details.cached_tokens is a cache read', () => {
    const usage = normalizeUsage({
      input_tokens: 50,
      output_tokens: 5,
      total_tokens: 55,
      input_tokens_details: { cached_tokens: 20 },
    });

    assert.deepEqual(usage, {
      prompt_tokens: 50,
      completion_tokens: 5,
      total_tokens: 55,
      cache_read_input_tokens: 20,
    });
  });

  test('Gemini: cachedContentTokenCount is a cache read inside promptTokenCount', () => {
    const usage = normalizeUsage({
      promptTokenCount: 80,
      candidatesTokenCount: 10,
      totalTokenCount: 90,
      cachedContentTokenCount: 60,
    });

    assert.deepEqual(usage, {
      prompt_tokens: 80,
      completion_tokens: 10,
      total_tokens: 90,
      cache_read_input_tokens: 60,
    });
  });

  test('extractUsage keeps cache fields and reported cost', () => {
    const usage = extractUsage({
      model: 'anthropic/claude-sonnet-4.5',
      usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 40 }, cost: '0.0005' },
    });

    assert.equal(usage.cache_read_input_tokens, 40);
    assert.equal(usage.provider_cost_usd, 0.0005);
    assert.equal(usage.model, 'anthropic/claude-sonnet-4.5');
  });
});
