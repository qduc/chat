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
});
