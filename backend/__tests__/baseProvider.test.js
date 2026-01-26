import { jest } from '@jest/globals';
import { BaseProvider, ProviderModelsError } from '../src/lib/providers/baseProvider.js';

// Create a concrete implementation for testing
class TestProvider extends BaseProvider {
  static get defaultBaseUrl() {
    return 'https://api.test.com';
  }

  createAdapter() {
    return {
      translateRequest: jest.fn().mockResolvedValue({ translated: true }),
      translateResponse: jest.fn().mockResolvedValue({ normalized: true }),
      translateStreamChunk: jest.fn().mockReturnValue({ chunk: true }),
    };
  }

  async makeHttpRequest(translatedRequest, _context = {}) {
    return { status: 200, body: { response: 'test' } };
  }

  needsStreamingTranslation() {
    return true;
  }
}

describe('BaseProvider', () => {
  describe('constructor', () => {
    test('should initialize with options', () => {
      const config = { apiKey: 'test-key', baseUrl: 'https://custom.api.com' };
      const provider = new TestProvider({
        config,
        providerId: 'test-provider',
        settings: { timeout: 5000 },
      });

      expect(provider.config).toBe(config);
      expect(provider.providerId).toBe('test-provider');
      expect(provider.settings).toEqual({ timeout: 5000 });
    });

    test('should default settings to empty object', () => {
      const provider = new TestProvider({});

      expect(provider.settings).toEqual({});
    });
  });

  describe('defaultBaseUrl', () => {
    test('should return null for base class', () => {
      expect(BaseProvider.defaultBaseUrl).toBeNull();
    });

    test('should return custom URL for subclass', () => {
      expect(TestProvider.defaultBaseUrl).toBe('https://api.test.com');
    });
  });

  describe('httpClient', () => {
    test('should return provided http function', () => {
      const httpFn = jest.fn();
      const provider = new TestProvider({ http: httpFn });

      expect(provider.httpClient).toBe(httpFn);
    });

    test('should fall back to globalThis.fetch', () => {
      const provider = new TestProvider({});
      // In Node.js, globalThis.fetch exists
      expect(provider.httpClient).toBeDefined();
    });
  });

  describe('getAdapter', () => {
    test('should create adapter on first call', () => {
      const provider = new TestProvider({});
      const adapter = provider.getAdapter();

      expect(adapter).toBeDefined();
      expect(adapter.translateRequest).toBeDefined();
    });

    test('should return cached adapter on subsequent calls', () => {
      const provider = new TestProvider({});
      const adapter1 = provider.getAdapter();
      const adapter2 = provider.getAdapter();

      expect(adapter1).toBe(adapter2);
    });
  });

  describe('refreshAdapter', () => {
    test('should clear and recreate adapter', () => {
      const provider = new TestProvider({});
      const adapter1 = provider.getAdapter();
      const adapter2 = provider.refreshAdapter();

      expect(adapter1).not.toBe(adapter2);
    });
  });

  describe('buildAdapterContext', () => {
    test('should return context unchanged by default', () => {
      const provider = new TestProvider({});
      const context = { key: 'value' };

      expect(provider.buildAdapterContext(context)).toEqual(context);
    });

    test('should return empty object for no context', () => {
      const provider = new TestProvider({});

      expect(provider.buildAdapterContext()).toEqual({});
    });
  });

  describe('translateRequest', () => {
    test('should delegate to adapter', async () => {
      const provider = new TestProvider({});
      const result = await provider.translateRequest({ model: 'test' });

      expect(result).toEqual({ translated: true });
    });
  });

  describe('translateResponse', () => {
    test('should delegate to adapter', async () => {
      const provider = new TestProvider({});
      const result = await provider.translateResponse({ raw: 'data' });

      expect(result).toEqual({ normalized: true });
    });
  });

  describe('translateStreamChunk', () => {
    test('should delegate to adapter', () => {
      const provider = new TestProvider({});
      const result = provider.translateStreamChunk({ data: 'chunk' });

      expect(result).toEqual({ chunk: true });
    });
  });

  describe('sendRequest', () => {
    test('should translate request, make HTTP call, and translate response', async () => {
      const provider = new TestProvider({});
      const result = await provider.sendRequest({ model: 'test' });

      expect(result).toEqual({ normalized: true });
    });
  });

  describe('sendRawRequest', () => {
    test('should translate request and return raw HTTP response', async () => {
      const provider = new TestProvider({});
      const result = await provider.sendRawRequest({ model: 'test' });

      expect(result).toEqual({ status: 200, body: { response: 'test' } });
    });
  });

  describe('streamRequest', () => {
    test('should translate request, make stream call, and translate response', async () => {
      const provider = new TestProvider({});
      const result = await provider.streamRequest({ model: 'test' });

      expect(result).toEqual({ normalized: true });
    });
  });

  describe('makeHttpRequest (base)', () => {
    test('should throw not implemented error', async () => {
      const provider = new BaseProvider({});

      await expect(provider.makeHttpRequest({})).rejects.toThrow('makeHttpRequest must be implemented');
    });
  });

  describe('makeStreamRequest', () => {
    test('should default to makeHttpRequest', async () => {
      const provider = new TestProvider({});
      const result = await provider.makeStreamRequest({ test: true });

      expect(result).toEqual({ status: 200, body: { response: 'test' } });
    });
  });

  describe('normalizeRequest (backward compat)', () => {
    test('should delegate to translateRequest', async () => {
      const provider = new TestProvider({});
      const result = await provider.normalizeRequest({ model: 'test' });

      expect(result).toEqual({ translated: true });
    });
  });

  describe('normalizeResponse (backward compat)', () => {
    test('should delegate to translateResponse', async () => {
      const provider = new TestProvider({});
      const result = await provider.normalizeResponse({ raw: 'data' });

      expect(result).toEqual({ normalized: true });
    });
  });

  describe('normalizeStreamChunk (backward compat)', () => {
    test('should delegate to translateStreamChunk', () => {
      const provider = new TestProvider({});
      const result = provider.normalizeStreamChunk({ data: 'chunk' });

      expect(result).toEqual({ chunk: true });
    });
  });

  describe('normalizeModelEntry', () => {
    test('should return null for null input', () => {
      const provider = new TestProvider({});

      expect(provider.normalizeModelEntry(null)).toBeNull();
    });

    test('should convert string to object with id', () => {
      const provider = new TestProvider({});
      const result = provider.normalizeModelEntry('gpt-4');

      expect(result).toEqual({ id: 'gpt-4' });
    });

    test('should handle Gemini-style model names', () => {
      const provider = new TestProvider({});
      const result = provider.normalizeModelEntry({
        name: 'models/gemini-pro',
        displayName: 'Gemini Pro',
      });

      expect(result).toEqual({
        name: 'models/gemini-pro',
        displayName: 'Gemini Pro',
        id: 'gemini-pro',
      });
    });

    test('should pass through objects with id', () => {
      const provider = new TestProvider({});
      const model = { id: 'claude-3', owned_by: 'anthropic' };
      const result = provider.normalizeModelEntry(model);

      expect(result).toBe(model);
    });

    test('should return null for object without id or valid name', () => {
      const provider = new TestProvider({});
      const result = provider.normalizeModelEntry({ foo: 'bar' });

      expect(result).toBeNull();
    });
  });

  describe('normalizeModelListPayload', () => {
    test('should handle OpenAI-style data array', () => {
      const provider = new TestProvider({});
      const payload = {
        data: [{ id: 'gpt-4' }, { id: 'gpt-3.5' }],
      };
      const result = provider.normalizeModelListPayload(payload);

      expect(result).toEqual([{ id: 'gpt-4' }, { id: 'gpt-3.5' }]);
    });

    test('should handle Gemini-style models array', () => {
      const provider = new TestProvider({});
      const payload = {
        models: [
          { name: 'models/gemini-pro' },
          { name: 'models/gemini-ultra' },
        ],
      };
      const result = provider.normalizeModelListPayload(payload);

      expect(result).toHaveLength(2);
    });

    test('should handle raw array', () => {
      const provider = new TestProvider({});
      const payload = ['gpt-4', 'gpt-3.5'];
      const result = provider.normalizeModelListPayload(payload);

      expect(result).toEqual([{ id: 'gpt-4' }, { id: 'gpt-3.5' }]);
    });

    test('should filter out null entries', () => {
      const provider = new TestProvider({});
      const payload = [{ id: 'gpt-4' }, null, { foo: 'bar' }];
      const result = provider.normalizeModelListPayload(payload);

      expect(result).toEqual([{ id: 'gpt-4' }]);
    });
  });

  describe('listModels', () => {
    test('should throw not implemented error', async () => {
      const provider = new TestProvider({});

      await expect(provider.listModels()).rejects.toThrow('TestProvider does not implement listModels');
    });
  });

  describe('getToolsetSpec', () => {
    test('should return empty array by default', () => {
      const provider = new TestProvider({});

      expect(provider.getToolsetSpec({})).toEqual([]);
    });
  });

  describe('supportsTools', () => {
    test('should return false by default', () => {
      const provider = new TestProvider({});

      expect(provider.supportsTools()).toBe(false);
    });
  });

  describe('supportsReasoningControls', () => {
    test('should return false by default', () => {
      const provider = new TestProvider({});

      expect(provider.supportsReasoningControls('gpt-4')).toBe(false);
    });
  });

  describe('getReasoningFormat', () => {
    test('should return none by default', () => {
      const provider = new TestProvider({});

      expect(provider.getReasoningFormat()).toBe('none');
    });
  });

  describe('supportsPromptCaching', () => {
    test('should return false by default', () => {
      const provider = new TestProvider({});

      expect(provider.supportsPromptCaching()).toBe(false);
    });
  });

  describe('needsStreamingTranslation', () => {
    test('should throw error for base class', () => {
      const provider = new BaseProvider({});

      expect(() => provider.needsStreamingTranslation()).toThrow(
        'BaseProvider must implement needsStreamingTranslation()'
      );
    });
  });

  describe('getDefaultModel', () => {
    test('should return config defaultModel if set', () => {
      const provider = new TestProvider({
        config: { defaultModel: 'custom-model' },
      });

      expect(provider.getDefaultModel()).toBe('custom-model');
    });

    test('should return undefined if no defaultModel in config', () => {
      const provider = new TestProvider({});

      expect(provider.getDefaultModel()).toBeUndefined();
    });
  });

  describe('isConfigured', () => {
    test('should return false by default', () => {
      const provider = new TestProvider({});

      expect(provider.isConfigured()).toBe(false);
    });
  });

  describe('createAdapter (base)', () => {
    test('should throw not implemented error', () => {
      const provider = new BaseProvider({});

      expect(() => provider.createAdapter()).toThrow('createAdapter must be implemented');
    });
  });
});

describe('ProviderModelsError', () => {
  test('should create error with message', () => {
    const error = new ProviderModelsError('Model list failed');

    expect(error.message).toBe('Model list failed');
    expect(error.name).toBe('ProviderModelsError');
  });

  test('should include status and body', () => {
    const error = new ProviderModelsError('Unauthorized', {
      status: 401,
      body: { error: 'Invalid API key' },
    });

    expect(error.status).toBe(401);
    expect(error.body).toEqual({ error: 'Invalid API key' });
  });

  test('should be instance of Error', () => {
    const error = new ProviderModelsError('Test');

    expect(error).toBeInstanceOf(Error);
  });
});
