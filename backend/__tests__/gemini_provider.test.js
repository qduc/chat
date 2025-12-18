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

    test('supportsTools returns true', () => {
      expect(provider.supportsTools()).toBe(true);
    });

    test('supportsReasoningControls returns false', () => {
      expect(provider.supportsReasoningControls()).toBe(false);
    });

    test('supportsPromptCaching returns false', () => {
      expect(provider.supportsPromptCaching()).toBe(false);
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

    test('translates tools and tool_choice', async () => {
      const request = {
        model: 'gemini-1.5-pro',
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [{
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: { location: { type: 'string' } } }
          }
        }],
        tool_choice: 'required'
      };

      const translated = await provider.translateRequest(request);

      expect(translated.tools).toBeDefined();
      expect(translated.tools[0].function_declarations[0].name).toBe('get_weather');
      expect(translated.tool_config.function_calling_config.mode).toBe('ANY');
    });

    test('translates multimodal content (images)', async () => {
      const request = {
        model: 'gemini-1.5-pro',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' } }
          ]
        }]
      };

      const translated = await provider.translateRequest(request);

      expect(translated.contents[0].parts).toHaveLength(2);
      expect(translated.contents[0].parts[0].text).toBe('What is in this image?');
      expect(translated.contents[0].parts[1].inline_data).toBeDefined();
      expect(translated.contents[0].parts[1].inline_data.mime_type).toBe('image/png');
      expect(translated.contents[0].parts[1].inline_data.data).toBe('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
    });

    test('translates tool history (assistant calls and tool results)', async () => {
      const request = {
        model: 'gemini-1.5-pro',
        messages: [
          { role: 'user', content: 'Call tool' },
          {
            role: 'assistant',
            tool_calls: [{
              id: 'call_123',
              function: { name: 'my_tool', arguments: '{"arg":1}' },
              gemini_thought_signature: 'sig_abc'
            }]
          },
          {
            role: 'tool',
            tool_call_id: 'call_123',
            content: '{"result":"ok"}'
          }
        ]
      };

      const translated = await provider.translateRequest(request);

      expect(translated.contents).toHaveLength(3);

      // Assistant turn
      expect(translated.contents[1].role).toBe('model');
      expect(translated.contents[1].parts[0].functionCall.name).toBe('my_tool');
      expect(translated.contents[1].parts[0].thoughtSignature).toBe('sig_abc');

      // Tool result turn
      expect(translated.contents[2].role).toBe('user');
      expect(translated.contents[2].parts[0].functionResponse.name).toBe('my_tool');
      expect(translated.contents[2].parts[0].functionResponse.response.content).toContain('ok');
    });

    test('translates tool_choice auto and none', async () => {
      const requestAuto = {
        model: 'gemini-1.5-pro',
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [{ function: { name: 't1', parameters: {} } }],
        tool_choice: 'auto'
      };
      const translatedAuto = await provider.translateRequest(requestAuto);
      expect(translatedAuto.tool_config.function_calling_config.mode).toBe('AUTO');

      const requestNone = { ...requestAuto, tool_choice: 'none' };
      const translatedNone = await provider.translateRequest(requestNone);
      expect(translatedNone.tool_config.function_calling_config.mode).toBe('NONE');
    });

    test('translates specific tool_choice function', async () => {
      const request = {
        model: 'gemini-1.5-pro',
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [{ function: { name: 'my_tool', parameters: {} } }],
        tool_choice: { type: 'function', function: { name: 'my_tool' } }
      };
      const translated = await provider.translateRequest(request);
      expect(translated.tool_config.function_calling_config.mode).toBe('ANY');
      expect(translated.tool_config.function_calling_config.allowed_function_names).toEqual(['my_tool']);
    });

    test('throws error when model is missing', async () => {
      const request = { messages: [{ role: 'user', content: 'Hi' }] };
      await expect(provider.translateRequest(request)).rejects.toThrow('Gemini provider requires a model');
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

    test('merges defaultHeaders from config and settings', async () => {
      const customProvider = new GeminiProvider({
        config: { providerConfig: { headers: { 'X-Config': '1' } } },
        settings: { headers: { 'X-Settings': '2' } },
        providerId: 'test',
        http: mockFetch
      });

      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

      await customProvider.makeHttpRequest({ __model: 'gemini' });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-Config']).toBe('1');
      expect(options.headers['X-Settings']).toBe('2');
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

    test('normalizes base URL for models endpoint', async () => {
      const customProvider = new GeminiProvider({
        config: { providerConfig: { apiKey: 'key', baseUrl: 'https://custom.api/v1' } },
        providerId: 'custom',
        http: mockFetch
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [] })
      });

      await customProvider.listModels();

      const [url] = mockFetch.mock.calls[0];
      // Should convert /v1 to /v1beta
      expect(url).toBe('https://custom.api/v1beta/models');
    });

    test('throws ProviderModelsError on API failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden')
      });

      await expect(provider.listModels()).rejects.toThrow('Failed to fetch models');
    });
  });

  describe('translateResponse Error Handling', () => {
    test('throws error for non-ok Response object', async () => {
      // Use a real Response object if available, or mock it
      const mockResponse = new Response('Something went wrong', {
        status: 500,
        statusText: 'Internal Server Error',
      });

      // We need to use the adapter directly or via provider.translateResponse
      // Since translateResponse is async and handles Response objects
      await expect(provider.translateResponse(mockResponse))
        .rejects.toThrow('Gemini API error: 500 Internal Server Error - Something went wrong');
    });
  });
});
