import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { OpenAIProvider } from '../src/lib/providers/openaiProvider.js';

describe('OpenAIProvider', () => {
  let provider;
  let mockFetch;

  beforeEach(() => {
    mockFetch = jest.fn();
    provider = new OpenAIProvider({
      config: { defaultModel: 'gpt-4.1-mini' },
      settings: { apiKey: 'test-api-key' },
      providerId: 'test-openai',
      http: mockFetch,
    });
  });

  describe('makeHttpRequest', () => {
    test('preserves streaming error body for downstream handlers', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          'data: {"error":{"message":"organization must be verified to stream"}}\n\n',
          {
            status: 400,
            headers: { 'Content-Type': 'text/event-stream' },
          }
        )
      );

      const response = await provider.makeHttpRequest({ stream: true, model: 'gpt-4.1-mini' });

      expect(response.ok).toBe(false);
      await expect(response.text()).resolves.toContain('organization must be verified to stream');
    });

    test('normalizes network fetch failures with provider name', async () => {
      const providerWithName = new OpenAIProvider({
        config: { defaultModel: 'gpt-4.1-mini' },
        settings: { apiKey: 'test-api-key', raw: { name: 'OpenAI Proxy' } },
        providerId: 'test-openai',
        http: mockFetch,
      });

      const cause = new Error('connect timeout');
      cause.code = 'UND_ERR_CONNECT_TIMEOUT';
      mockFetch.mockRejectedValue(Object.assign(new Error('fetch failed'), { cause }));

      await expect(providerWithName.makeHttpRequest({ model: 'gpt-4.1-mini' }))
        .rejects.toThrow('Could not connect to provider OpenAI Proxy.');
    });
  });

  describe('getReasoningFormat', () => {
    test('uses DeepSeek reasoning format for api.deepseek.com providers', () => {
      const deepSeekProvider = new OpenAIProvider({
        config: { defaultModel: 'deepseek-v4-pro' },
        settings: { apiKey: 'test-api-key', baseUrl: 'https://api.deepseek.com/v1' },
        providerId: 'test-deepseek',
        http: mockFetch,
      });

      expect(deepSeekProvider.getReasoningFormat()).toBe('deepseek');
    });

    test('translates reasoning controls into DeepSeek request shape', async () => {
      const deepSeekProvider = new OpenAIProvider({
        config: { defaultModel: 'deepseek-v4-pro' },
        settings: { apiKey: 'test-api-key', baseUrl: 'https://api.deepseek.com' },
        providerId: 'test-deepseek',
        http: mockFetch,
      });

      await expect(deepSeekProvider.translateRequest({
        messages: [{ role: 'user', content: 'hi' }],
        reasoning_effort: 'xhigh',
      })).resolves.toMatchObject({
        model: 'deepseek-v4-pro',
        thinking: { type: 'enabled' },
        reasoning_effort: 'max',
      });
    });
  });

  describe('listModels', () => {
    test('normalizes timeout failures with provider name', async () => {
      const providerWithName = new OpenAIProvider({
        config: { defaultModel: 'gpt-4.1-mini' },
        settings: { apiKey: 'test-api-key', raw: { name: 'OpenAI Proxy' } },
        providerId: 'test-openai',
        http: mockFetch,
      });

      mockFetch.mockRejectedValue(Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'AbortError',
      }));

      await expect(providerWithName.listModels({ timeoutMs: 10 }))
        .rejects.toThrow('Timed out when trying to fetch provider OpenAI Proxy.');
    });
  });
});
