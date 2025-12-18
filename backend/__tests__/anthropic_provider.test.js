import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { AnthropicProvider } from '../src/lib/providers/anthropicProvider.js';
import { MessagesAdapter } from '../src/lib/adapters/messagesAdapter.js';

describe('AnthropicProvider', () => {
  let provider;
  let mockConfig;

  beforeEach(() => {
    mockConfig = {
      anthropicApiKey: 'test-api-key',
      defaultModel: 'claude-3-5-sonnet-20241022',
    };
    provider = new AnthropicProvider({
      config: mockConfig,
      providerId: 'test-provider',
    });
  });

  describe('getToolsetSpec', () => {
    test('returns tools in OpenAI format (not Anthropic format)', () => {
      const openAITools = [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the current weather',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
              required: ['location'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'search_web',
            description: 'Search the web',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string' },
              },
            },
          },
        },
      ];

      const result = provider.getToolsetSpec(openAITools);

      // Should return the same array (OpenAI format)
      expect(result).toEqual(openAITools);
      expect(result).toHaveLength(2);

      // Verify it's in OpenAI format, not Anthropic format
      expect(result[0].type).toBe('function');
      expect(result[0].function).toBeDefined();
      expect(result[0].function.name).toBe('get_weather');
      expect(result[0].function.parameters).toBeDefined();

      // Should NOT be in Anthropic format (which has name, description, input_schema at top level)
      expect(result[0].input_schema).toBeUndefined();
    });

    test('returns OpenAI format when given tool registry object', () => {
      const mockRegistry = {
        generateOpenAIToolSpecs: () => [
          {
            type: 'function',
            function: {
              name: 'calculator',
              description: 'Perform calculations',
              parameters: {
                type: 'object',
                properties: {
                  expression: { type: 'string' },
                },
              },
            },
          },
        ],
      };

      const result = provider.getToolsetSpec(mockRegistry);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('function');
      expect(result[0].function.name).toBe('calculator');

      // Should NOT be converted to Anthropic format
      expect(result[0].input_schema).toBeUndefined();
    });

    test('returns empty array when no tools provided', () => {
      expect(provider.getToolsetSpec(null)).toEqual([]);
      expect(provider.getToolsetSpec(undefined)).toEqual([]);
      expect(provider.getToolsetSpec([])).toEqual([]);
    });

    test('handles generateToolSpecs fallback', () => {
      const mockRegistry = {
        generateToolSpecs: () => [
          {
            type: 'function',
            function: {
              name: 'test_tool',
              description: 'A test tool',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      };

      const result = provider.getToolsetSpec(mockRegistry);

      expect(result).toHaveLength(1);
      expect(result[0].function.name).toBe('test_tool');
    });
  });

  describe('Integration with MessagesAdapter', () => {
    test('tools flow correctly from provider through adapter to Anthropic format', async () => {
      const adapter = provider.createAdapter();
      expect(adapter).toBeInstanceOf(MessagesAdapter);

      const openAITools = [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the current weather',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string', description: 'City name' },
              },
              required: ['location'],
            },
          },
        },
      ];

      // Simulate the flow: getToolsetSpec returns OpenAI format
      const toolsFromProvider = provider.getToolsetSpec(openAITools);
      expect(toolsFromProvider[0].type).toBe('function');
      expect(toolsFromProvider[0].function).toBeDefined();

      // Then the adapter translates the request, converting tools to Anthropic format
      const internalRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: toolsFromProvider,
        max_tokens: 1000,
      };

      const translatedRequest = await adapter.translateRequest(internalRequest);

      // Adapter should convert to Anthropic format
      expect(translatedRequest.tools).toBeDefined();
      expect(translatedRequest.tools).toHaveLength(1);

      // Verify it's in Anthropic format (name, description, input_schema at top level)
      const anthropicTool = translatedRequest.tools[0];
      expect(anthropicTool.name).toBe('get_weather');
      expect(anthropicTool.description).toBe('Get the current weather');
      expect(anthropicTool.input_schema).toBeDefined();
      expect(anthropicTool.input_schema.type).toBe('object');
      expect(anthropicTool.input_schema.properties.location).toBeDefined();
      expect(anthropicTool.input_schema.required).toEqual(['location']);

      // Should NOT have OpenAI structure
      expect(anthropicTool.type).toBeUndefined();
      expect(anthropicTool.function).toBeUndefined();
    });

    test('full request includes tools in final translated format', async () => {
      const openAITools = [
        {
          type: 'function',
          function: {
            name: 'search',
            description: 'Search for information',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string' },
              },
            },
          },
        },
      ];

      const internalRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Search for AI news' },
        ],
        tools: openAITools,
        tool_choice: 'auto',
      };

      // Translate the request using the adapter
      const translatedRequest = await provider.translateRequest(internalRequest);

      // Verify tools are present and properly formatted
      expect(translatedRequest.tools).toBeDefined();
      expect(translatedRequest.tools).toHaveLength(1);
      expect(translatedRequest.tools[0].name).toBe('search');
      expect(translatedRequest.tools[0].input_schema).toBeDefined();

      // Verify tool_choice is converted
      expect(translatedRequest.tool_choice).toEqual({ type: 'auto' });

      // Verify other fields
      expect(translatedRequest.model).toBe('claude-3-5-sonnet-20241022');
      expect(translatedRequest.system).toBe('You are helpful');
      expect(translatedRequest.messages).toHaveLength(1);
      expect(translatedRequest.messages[0].content).toBe('Search for AI news');
    });
  });

  describe('supportsTools', () => {
    test('returns true', () => {
      expect(provider.supportsTools()).toBe(true);
    });
  });

  describe('createAdapter', () => {
    test('creates MessagesAdapter instance', () => {
      const adapter = provider.createAdapter();
      expect(adapter).toBeInstanceOf(MessagesAdapter);
    });
  });

  describe('makeHttpRequest', () => {
    let mockFetch;

    beforeEach(() => {
      mockFetch = jest.fn();
      provider = new AnthropicProvider({
        config: mockConfig,
        providerId: 'test-provider',
        http: mockFetch,
      });
    });

    test('handles successful response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map(),
        clone: () => ({ text: () => Promise.resolve('{"id":"msg_123"}') }),
        json: () => Promise.resolve({ id: 'msg_123' }),
      });

      const response = await provider.makeHttpRequest({
        model: 'claude-3-5-sonnet-20241022',
        messages: [],
      });

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.anthropic.com/v1/messages'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-api-key': 'test-api-key',
            'anthropic-version': '2023-06-01',
          }),
        })
      );
    });

    test('handles API error response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Map(),
        text: () => Promise.resolve('{"type":"error","error":{"type":"invalid_request_error","message":"Bad request"}}'),
        clone: () => ({ text: () => Promise.resolve('{"type":"error"}') }),
      });

      // The provider itself doesn't throw on makeHttpRequest (unless network error), it returns the response
      // The error handling usually happens in translateResponse or by the caller
      const response = await provider.makeHttpRequest({});
      expect(response.status).toBe(400);
    });

    test('throws on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(provider.makeHttpRequest({})).rejects.toThrow('Network error');
    });
  });

  describe('listModels', () => {
    let mockFetch;

    beforeEach(() => {
      mockFetch = jest.fn();
      provider = new AnthropicProvider({
        config: mockConfig,
        providerId: 'test-provider',
        http: mockFetch,
      });
    });

    test('fetches and returns models', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: [
            { id: 'claude-3-opus-20240229', display_name: 'Claude 3 Opus' },
            { id: 'claude-3-sonnet-20240229', display_name: 'Claude 3 Sonnet' },
          ],
        }),
      });

      const models = await provider.listModels();

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('claude-3-opus-20240229');
      
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/models',
        expect.objectContaining({ method: 'GET' })
      );
    });

    test('throws ProviderModelsError on failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(provider.listModels()).rejects.toThrow('Failed to fetch models');
    });
  });

  describe('Streaming Integration', () => {
    test('needsStreamingTranslation returns true', () => {
      expect(provider.needsStreamingTranslation()).toBe(true);
    });

    test('translateStreamChunk delegates to adapter', () => {
      // Create a provider
      provider = new AnthropicProvider({
        config: mockConfig,
        providerId: 'test-provider',
      });

      // Mock the adapter's translateStreamChunk
      const mockAdapter = {
        translateStreamChunk: jest.fn().mockReturnValue('translated-chunk'),
        translateRequest: jest.fn(),
        translateResponse: jest.fn(),
      };
      
      // Inject the mock adapter (since getAdapter creates one, we can spy on createAdapter or just replace the property if accessible, 
      // but BaseProvider caches it in this.adapter)
      provider.adapter = mockAdapter;

      const result = provider.translateStreamChunk('chunk');
      expect(result).toBe('translated-chunk');
      expect(mockAdapter.translateStreamChunk).toHaveBeenCalledWith('chunk', expect.anything());
    });
  });

  describe('Regression test for tool format bug', () => {
    test('CRITICAL: getToolsetSpec must never return Anthropic-formatted tools', () => {
      // This is the bug we're preventing: getToolsetSpec was converting to Anthropic format
      const openAITools = [
        {
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'Test description',
            parameters: {
              type: 'object',
              properties: { arg: { type: 'string' } },
            },
          },
        },
      ];

      const result = provider.getToolsetSpec(openAITools);

      // MUST NOT have Anthropic format structure
      for (const tool of result) {
        // OpenAI format checks
        expect(tool.type).toBe('function');
        expect(tool.function).toBeDefined();
        expect(tool.function.name).toBeDefined();
        expect(tool.function.parameters).toBeDefined();

        // Should NOT have Anthropic format at top level
        expect(tool.input_schema).toBeUndefined();
        expect(tool.name).toBeUndefined();
        expect(tool.description).toBeUndefined();
      }
    });

    test('CRITICAL: translateRequest must include tools in the final request body', async () => {
      const openAITools = [
        {
          type: 'function',
          function: {
            name: 'web_search',
            description: 'Search the web',
            parameters: {
              type: 'object',
              properties: { query: { type: 'string' } },
            },
          },
        },
      ];

      const internalRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Search for something' }],
        tools: openAITools,
      };

      const translatedRequest = await provider.translateRequest(internalRequest);

      // This is the actual bug: tools were missing from the request
      expect(translatedRequest.tools).toBeDefined();
      expect(translatedRequest.tools).toHaveLength(1);
      expect(translatedRequest.tools[0].name).toBe('web_search');
      expect(translatedRequest.tools[0].input_schema).toBeDefined();
    });

    test('tools must be preserved through the entire provider flow', async () => {
      // Simulate the full flow from toolsStreaming.js
      const mockToolRegistry = {
        generateOpenAIToolSpecs: () => [
          {
            type: 'function',
            function: {
              name: 'calculator',
              description: 'Perform calculations',
              parameters: {
                type: 'object',
                properties: { expression: { type: 'string' } },
              },
            },
          },
        ],
      };

      // Step 1: Get tool specs from provider (should be OpenAI format)
      const toolSpecs = provider.getToolsetSpec(mockToolRegistry);
      expect(toolSpecs).toHaveLength(1);
      expect(toolSpecs[0].type).toBe('function');

      // Step 2: Build request body with tools
      const requestBody = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Calculate 2+2' }],
        tools: toolSpecs,
      };

      // Step 3: Translate request (should convert to Anthropic format)
      const translatedRequest = await provider.translateRequest(requestBody);

      // Tools must be present in Anthropic format
      expect(translatedRequest.tools).toBeDefined();
      expect(translatedRequest.tools).toHaveLength(1);
      expect(translatedRequest.tools[0].name).toBe('calculator');
      expect(translatedRequest.tools[0].input_schema).toBeDefined();
      expect(translatedRequest.tools[0].input_schema.properties.expression).toBeDefined();
    });
  });
});
