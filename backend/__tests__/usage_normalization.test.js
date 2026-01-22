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
});
