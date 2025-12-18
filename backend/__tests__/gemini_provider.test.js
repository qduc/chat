import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { GeminiProvider } from '../src/lib/providers/geminiProvider.js';

describe('GeminiProvider', () => {
  let provider;
  let mockConfig;
  let mockFetch;

  beforeEach(() => {
    mockConfig = {
      providerConfig: {
        apiKey: 'test-api-key',
      },
      defaultModel: 'gemini-1.5-pro',
    };
    mockFetch = jest.fn();
    provider = new GeminiProvider({
      config: mockConfig,
      providerId: 'test-gemini',
      http: mockFetch,
    });
  });

  describe('Configuration', () => {
    test('isConfigured returns true when apiKey is present', () => {
      expect(provider.isConfigured()).toBe(true);
    });

    test('isConfigured returns false when apiKey is missing', () => {
      const emptyProvider = new GeminiProvider({ config: {}, providerId: 'test' });
      expect(emptyProvider.isConfigured()).toBe(false);
    });

    test('uses default base URL', () => {
      expect(provider.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
    });

    test('getDefaultModel returns correct default', () => {
      expect(provider.getDefaultModel()).toBe('gemini-1.5-pro');
    });
  });

  describe('getToolsetSpec', () => {
    test('returns empty array', () => {
      const toolRegistry = {
        generateOpenAIToolSpecs: () => [{ name: 'test' }],
      };
      // Gemini provider relies on adapter to generate tools during translation
      expect(provider.getToolsetSpec(toolRegistry)).toEqual([]);
    });
  });

  describe('Request Translation Integration', () => {
    test('translateRequest delegates to GeminiAdapter', async () => {
      const request = {
        model: 'gemini-1.5-flash',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      };

      const translated = await provider.translateRequest(request);

      expect(translated).toBeDefined();
      expect(translated.__model).toBe('gemini-1.5-flash');
      expect(translated.__stream).toBe(true);
      expect(translated.contents).toHaveLength(1);
      expect(translated.contents[0].parts[0].text).toBe('Hello');
    });

    test('converts system messages to system_instruction', async () => {
      const request = {
        model: 'gemini-1.5-flash',
        messages: [
          { role: 'system', content: 'Be helpful' },
          { role: 'user', content: 'Hi' },
        ],
      };

      const translated = await provider.translateRequest(request);

      expect(translated.system_instruction).toBeDefined();
      expect(translated.system_instruction.parts[0].text).toBe('Be helpful');
      // System message should be removed from contents
      expect(translated.contents).toHaveLength(1);
      expect(translated.contents[0].role).toBe('user');
    });
  });

  describe('Response Translation Integration', () => {
    test('translateResponse converts Gemini candidate to OpenAI format', async () => {
      const geminiResponse = {
        candidates: [{
          content: {
            parts: [{ text: 'Hello world' }],
            role: 'model',
          },
          finishReason: 'STOP',
          index: 0,
        }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const translated = await provider.translateResponse(geminiResponse);

      expect(translated.id).toBeDefined();
      expect(translated.choices).toHaveLength(1);
      expect(translated.choices[0].message.content).toBe('Hello world');
      expect(translated.choices[0].message.role).toBe('assistant');
      expect(translated.choices[0].finish_reason).toBe('stop');
      expect(translated.usage.total_tokens).toBe(15);
    });
  });

  describe('makeHttpRequest', () => {
    test('constructs correct URL for non-streaming request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        clone: () => ({ text: () => Promise.resolve('{}') }),
        json: () => Promise.resolve({}),
      });

      const translatedRequest = {
        contents: [{ parts: [{ text: 'test' }] }],
        __model: 'gemini-1.5-pro',
        __stream: false,
      };

      await provider.makeHttpRequest(translatedRequest);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];

      expect(url).toContain('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent');
      expect(url).toContain('key=test-api-key');
      expect(options.method).toBe('POST');
      expect(options.body).toContain('"contents"');
      expect(options.body).not.toContain('__model'); // Should be cleaned up
    });

    test('constructs correct URL for streaming request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        body: { getReader: () => {} }, // Mock stream body
      });

      const translatedRequest = {
        contents: [{ parts: [{ text: 'test' }] }],
        __model: 'gemini-1.5-pro',
        __stream: true,
      };

      await provider.makeHttpRequest(translatedRequest);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain(':streamGenerateContent');
      expect(url).toContain('alt=sse');
    });

    test('handles network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network failure'));
      
      const translatedRequest = {
        contents: [],
        __model: 'gemini',
      };

      await expect(provider.makeHttpRequest(translatedRequest)).rejects.toThrow('Network failure');
    });
  });

  describe('listModels', () => {
    test('fetches and normalizes models', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          models: [
            { name: 'models/gemini-pro', displayName: 'Gemini Pro' },
            { name: 'models/gemini-vision', displayName: 'Gemini Vision' },
          ],
        }),
      });

      const models = await provider.listModels();

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('gemini-pro');
      expect(models[1].id).toBe('gemini-vision');
      
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models');
    });
  });
});
