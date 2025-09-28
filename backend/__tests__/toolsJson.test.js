import { jest } from '@jest/globals';

/**
 * Tests for toolsJson.js - Tool orchestration system for OpenAI API proxy
 *
 * Current coverage: Basic happy paths, tool execution, error handling, streaming
 *
 * Missing test cases (practical improvements):
 *
 * SIMPLE EDGE CASES:
 * - LLM response with null/empty content
 * - LLM response with missing choices array
 * - Tool calls with empty arguments string
 * - Multiple tool calls in single response
 * - Tool call with unknown/unregistered tool name
 *
 * ERROR SCENARIOS:
 * - Malformed JSON in tool call arguments
 * - Provider creation/initialization failures
 * - Persistence layer failures during orchestration
 * - Network timeouts during LLM requests
 *
 * CONFIGURATION EDGE CASES:
 * - Missing required config values (defaultModel, etc.)
 * - Invalid reasoning controls when provider doesn't support them
 * - Tool execution with partial provider failures
 *
 * CLASS-LEVEL TESTS:
 * - OrchestrationConfig.fromRequest() with various inputs
 * - ResponseHandlerFactory.create() selection logic
 * - Individual response handler behavior
 *
 * BOUNDARY CONDITIONS:
 * - Exactly at max iterations limit
 * - Tool output exceeding size limits
 * - Very large conversation message arrays
 */

// Use ESM-compatible, non-hoisted mocks to avoid module resolution during setup
const toolsModulePath = new URL('../src/lib/tools.js', import.meta.url).href;
await jest.unstable_mockModule(toolsModulePath, () => ({
  generateOpenAIToolSpecs: jest.fn(() => [
    { type: 'function', function: { name: 'test_tool', description: 'Test tool' } }
  ]),
  generateToolSpecs: jest.fn(() => ['test_tool'])
}));
const responseUtilsPath = new URL('../src/lib/responseUtils.js', import.meta.url).href;
await jest.unstable_mockModule(responseUtilsPath, () => ({
  addConversationMetadata: jest.fn((response) => response)
}));

const streamUtilsPath = new URL('../src/lib/streamUtils.js', import.meta.url).href;
await jest.unstable_mockModule(streamUtilsPath, () => ({
  setupStreamingHeaders: jest.fn(),
  createOpenAIRequest: jest.fn()
}));

const providersIndexPath = new URL('../src/lib/providers/index.js', import.meta.url).href;
await jest.unstable_mockModule(providersIndexPath, () => ({
  createProvider: jest.fn()
}));

const toolOrchestrationUtilsPath = new URL('../src/lib/toolOrchestrationUtils.js', import.meta.url).href;
await jest.unstable_mockModule(toolOrchestrationUtilsPath, () => ({
  buildConversationMessagesAsync: jest.fn(),
  executeToolCall: jest.fn(),
  appendToPersistence: jest.fn(),
  recordFinalToPersistence: jest.fn(),
  emitConversationMetadata: jest.fn(),
  streamDeltaEvent: jest.fn(),
  streamDone: jest.fn()
}));

// Import the module under test AFTER mocking
const { handleToolsJson } = await import('../src/lib/toolsJson.js');

// Import the mocked functions for setup
const { setupStreamingHeaders, createOpenAIRequest } = await import('../src/lib/streamUtils.js');
const {
  buildConversationMessagesAsync,
  executeToolCall,
  streamDeltaEvent,
  appendToPersistence,
  recordFinalToPersistence
} = await import('../src/lib/toolOrchestrationUtils.js');
const { createProvider } = await import('../src/lib/providers/index.js');

describe('toolsJson', () => {
  let mockRes, mockReq, mockPersistence, mockConfig;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Set up default mock implementations
    buildConversationMessagesAsync.mockResolvedValue([
      { role: 'user', content: 'Hello' }
    ]);

    createProvider.mockResolvedValue({
      getToolsetSpec: jest.fn(() => [
        { type: 'function', function: { name: 'provider_tool', description: 'Provider tool' } }
      ]),
      supportsReasoningControls: jest.fn(() => false)
    });

    // Mock response object
    mockRes = {
      write: jest.fn(),
      end: jest.fn(),
      status: jest.fn(() => mockRes),
      json: jest.fn(),
      flush: jest.fn(),
      writableEnded: false
    };

    // Mock request object
    mockReq = {
      on: jest.fn(),
      header: jest.fn(() => undefined)
    };

    // Mock persistence
    mockPersistence = {
      persist: true,
      markError: jest.fn()
    };

    // Mock config
    mockConfig = {
      defaultModel: 'gpt-3.5-turbo'
    };
  });

  describe('OrchestrationConfig', () => {
    // We need to extract the class to test it directly
    // Since the classes are not exported, we'll test them indirectly through handleToolsJson
  });

  describe('handleToolsJson - main integration tests', () => {
    test('handles simple non-streaming request without tools', async () => {
      const body = {
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false
      };
      const bodyIn = {};

      // Mock LLM response without tool calls
      const mockLLMResponse = {
        choices: [{
          message: { role: 'assistant', content: 'Hello world' },
          finish_reason: 'stop'
        }]
      };

      createOpenAIRequest.mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockLLMResponse)
      });

      await handleToolsJson({
        body,
        bodyIn,
        config: mockConfig,
        res: mockRes,
        req: mockReq,
        persistence: mockPersistence
      });

      // Should return JSON response
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          choices: mockLLMResponse.choices,
          tool_events: expect.arrayContaining([
            expect.objectContaining({
              type: 'text',
              value: 'Hello world'
            })
          ])
        })
      );
    });

    test('handles streaming request without tools', async () => {
      const body = {
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true
      };
      const bodyIn = {};

      // Mock LLM response without tool calls
      const mockLLMResponse = {
        choices: [{
          message: { role: 'assistant', content: 'Hello world' },
          finish_reason: 'stop'
        }]
      };

      createOpenAIRequest.mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockLLMResponse)
      });

      await handleToolsJson({
        body,
        bodyIn,
        config: mockConfig,
        res: mockRes,
        req: mockReq,
        persistence: mockPersistence
      });

      // Should set up streaming headers
      expect(setupStreamingHeaders).toHaveBeenCalledWith(mockRes);
      expect(mockRes.end).toHaveBeenCalled();
    });

    test('handles request with tool calls', async () => {
      const body = {
        messages: [{ role: 'user', content: 'What time is it?' }],
        stream: false,
        tools: [{ type: 'function', function: { name: 'get_time' } }]
      };
      const bodyIn = {};

      // Mock LLM response with tool calls
      const mockLLMResponseWithTools = {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Let me check the time.',
            tool_calls: [{
              id: 'call_123',
              type: 'function',
              function: { name: 'get_time', arguments: '{}' }
            }]
          }
        }]
      };

      // Mock final LLM response after tool execution
      const mockFinalResponse = {
        choices: [{
          message: { role: 'assistant', content: 'The current time is 3:00 PM' },
          finish_reason: 'stop'
        }]
      };

      createOpenAIRequest
        .mockResolvedValueOnce({
          json: jest.fn().mockResolvedValue(mockLLMResponseWithTools)
        })
        .mockResolvedValueOnce({
          json: jest.fn().mockResolvedValue(mockFinalResponse)
        });

      executeToolCall.mockResolvedValue({
        name: 'get_time',
        output: '3:00 PM'
      });

      await handleToolsJson({
        body,
        bodyIn,
        config: mockConfig,
        res: mockRes,
        req: mockReq,
        persistence: mockPersistence
      });

      // Should execute tool and return final response
      expect(executeToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'call_123',
          type: 'function',
          function: { name: 'get_time', arguments: '{}' }
        })
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_events: expect.arrayContaining([
            expect.objectContaining({ type: 'text', value: 'Let me check the time.' }),
            expect.objectContaining({ type: 'tool_call' }),
            expect.objectContaining({ type: 'tool_output' }),
            expect.objectContaining({ type: 'text', value: 'The current time is 3:00 PM' })
          ])
        })
      );
    });

    test('handles multiple tool calls in a single response', async () => {
      const body = {
        messages: [{ role: 'user', content: 'Run a couple of tools' }],
        stream: false,
        tools: [{ type: 'function', function: { name: 'tool_one' } }]
      };
      const bodyIn = {};

      const toolCalls = [
        {
          id: 'call_one',
          type: 'function',
          function: { name: 'tool_one', arguments: '{}' }
        },
        {
          id: 'call_two',
          type: 'function',
          function: { name: 'tool_two', arguments: '' }
        }
      ];

      const initialResponse = {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Working on it...',
            tool_calls: toolCalls
          }
        }]
      };

      const finalResponse = {
        choices: [{
          message: { role: 'assistant', content: 'All done' },
          finish_reason: 'stop'
        }]
      };

      createOpenAIRequest
        .mockResolvedValueOnce({ json: jest.fn().mockResolvedValue(initialResponse) })
        .mockResolvedValueOnce({ json: jest.fn().mockResolvedValue(finalResponse) });

      executeToolCall
        .mockResolvedValueOnce({ name: 'tool_one', output: 'first result' })
        .mockResolvedValueOnce({ name: 'tool_two', output: { ok: true } });

      await handleToolsJson({
        body,
        bodyIn,
        config: mockConfig,
        res: mockRes,
        req: mockReq,
        persistence: mockPersistence
      });

      expect(executeToolCall).toHaveBeenNthCalledWith(1, toolCalls[0]);
      expect(executeToolCall).toHaveBeenNthCalledWith(2, toolCalls[1]);

      const responseArg = mockRes.json.mock.calls[0][0];
      const toolCallEvents = responseArg.tool_events.filter((event) => event.type === 'tool_call');
      const toolOutputEvents = responseArg.tool_events.filter((event) => event.type === 'tool_output');

      expect(toolCallEvents).toHaveLength(2);
      expect(toolCallEvents.map((event) => event.value.id)).toEqual(['call_one', 'call_two']);
      expect(toolOutputEvents).toHaveLength(2);
      expect(toolOutputEvents[1].value.output).toEqual({ ok: true });
    });

    test('handles tool execution error', async () => {
      const body = {
        messages: [{ role: 'user', content: 'What time is it?' }],
        stream: false,
        tools: [{ type: 'function', function: { name: 'get_time' } }]
      };
      const bodyIn = {};

      const mockLLMResponseWithTools = {
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_123',
              type: 'function',
              function: { name: 'get_time', arguments: '{}' }
            }]
          }
        }]
      };

      const mockFinalResponse = {
        choices: [{
          message: { role: 'assistant', content: 'I had trouble getting the time' },
          finish_reason: 'stop'
        }]
      };

      createOpenAIRequest
        .mockResolvedValueOnce({
          json: jest.fn().mockResolvedValue(mockLLMResponseWithTools)
        })
        .mockResolvedValueOnce({
          json: jest.fn().mockResolvedValue(mockFinalResponse)
        });

      executeToolCall.mockRejectedValue(new Error('Tool failed'));

      await handleToolsJson({
        body,
        bodyIn,
        config: mockConfig,
        res: mockRes,
        req: mockReq,
        persistence: mockPersistence
      });

      // Should handle tool error gracefully
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_events: expect.arrayContaining([
            expect.objectContaining({
              type: 'tool_output',
              value: expect.objectContaining({
                output: 'Tool get_time failed: Tool failed'
              })
            })
          ])
        })
      );
    });

    test('handles maximum iterations reached', async () => {
      const body = {
        messages: [{ role: 'user', content: 'Keep calling tools' }],
        stream: false,
        tools: [{ type: 'function', function: { name: 'infinite_tool' } }]
      };
      const bodyIn = {};

      // Mock LLM to always return tool calls (simulating infinite loop)
      const mockLLMResponseWithTools = {
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_123',
              type: 'function',
              function: { name: 'infinite_tool', arguments: '{}' }
            }]
          }
        }]
      };

      const mockFinalResponse = {
        choices: [{
          message: { role: 'assistant', content: 'Final response' },
          finish_reason: 'stop'
        }]
      };

      // Return tool calls for first 10 iterations, then final response
      let callCount = 0;
      createOpenAIRequest.mockImplementation(() => {
        const response = {
          json: jest.fn().mockImplementation(() => {
            callCount += 1;
            if (callCount > 10) return Promise.resolve(mockFinalResponse);
            return Promise.resolve(mockLLMResponseWithTools);
          })
        };
        return Promise.resolve(response);
      });

      executeToolCall.mockResolvedValue({
        name: 'infinite_tool',
        output: 'tool result'
      });

      await handleToolsJson({
        body,
        bodyIn,
        config: mockConfig,
        res: mockRes,
        req: mockReq,
        persistence: mockPersistence
      });

      // Should eventually hit max iterations
      expect(executeToolCall).toHaveBeenCalledTimes(10); // max iterations
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_events: expect.arrayContaining([
            expect.objectContaining({
              type: 'text',
              value: '\n\n[Maximum iterations reached]'
            })
          ])
        })
      );
    });

    test('handles streaming response errors', async () => {
      const body = {
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true
      };
      const bodyIn = {};

      createOpenAIRequest.mockRejectedValue(new Error('Network error'));

      await handleToolsJson({
        body,
        bodyIn,
        config: mockConfig,
        res: mockRes,
        req: mockReq,
        persistence: mockPersistence
      });

      // Should handle error in streaming mode
      expect(streamDeltaEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: { content: '[Error: Network error]' }
        })
      );
      expect(mockRes.end).toHaveBeenCalled();
    });

    test('handles JSON response errors', async () => {
      const body = {
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false
      };
      const bodyIn = {};

      createOpenAIRequest.mockRejectedValue(new Error('Network error'));

      await handleToolsJson({
        body,
        bodyIn,
        config: mockConfig,
        res: mockRes,
        req: mockReq,
        persistence: mockPersistence
      });

      // Should return error response
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: {
            message: 'Network error',
            type: 'tool_orchestration_error'
          },
          tool_events: expect.arrayContaining([
            expect.objectContaining({
              type: 'text',
              value: '[Error: Network error]'
            })
          ])
        })
      );
    });

    test('returns empty tool events when assistant message has no content', async () => {
      appendToPersistence.mockClear();
      recordFinalToPersistence.mockClear();

      const body = {
        messages: [{ role: 'user', content: 'Return metadata only' }],
        stream: false
      };
      const bodyIn = {};

      const responseWithoutContent = {
        choices: [{
          message: { role: 'assistant', content: null },
          finish_reason: 'stop'
        }]
      };

      createOpenAIRequest.mockResolvedValue({
        json: jest.fn().mockResolvedValue(responseWithoutContent)
      });

      await handleToolsJson({
        body,
        bodyIn,
        config: mockConfig,
        res: mockRes,
        req: mockReq,
        persistence: mockPersistence
      });

      const responseArg = mockRes.json.mock.calls[0][0];
      expect(responseArg.tool_events).toHaveLength(0);
      expect(recordFinalToPersistence).not.toHaveBeenCalled();
      expect(appendToPersistence).not.toHaveBeenCalledWith(mockPersistence, undefined);
    });

    test('handles client abort', async () => {
      const body = {
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true
      };
      const bodyIn = {};

      mockReq.on.mockImplementation((event, handler) => {
        if (event === 'close' && typeof handler === 'function') {
          // Simulate client abort immediately when handler is registered
          handler();
        }
      });

      const mockLLMResponse = {
        choices: [{
          message: { role: 'assistant', content: 'Hello world' },
          finish_reason: 'stop'
        }]
      };

      createOpenAIRequest.mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockLLMResponse)
      });

      const handlePromise = handleToolsJson({
        body,
        bodyIn,
        config: mockConfig,
        res: mockRes,
        req: mockReq,
        persistence: mockPersistence
      });

  // client abort simulated by mockReq.on implementation

      await handlePromise;

      expect(mockPersistence.markError).toHaveBeenCalled();
    });

    test('uses provider-specific configuration', async () => {
      const body = {
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false
      };
      const bodyIn = { provider_id: 'custom-provider' };

      const mockProvider = {
        getToolsetSpec: jest.fn(() => [
          { type: 'function', function: { name: 'custom_tool' } }
        ]),
        supportsReasoningControls: jest.fn(() => true)
      };

      createProvider.mockResolvedValue(mockProvider);

      const mockLLMResponse = {
        choices: [{
          message: { role: 'assistant', content: 'Hello world' },
          finish_reason: 'stop'
        }]
      };

      createOpenAIRequest.mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockLLMResponse)
      });

      await handleToolsJson({
        body,
        bodyIn,
        config: mockConfig,
        res: mockRes,
        req: mockReq,
        persistence: mockPersistence
      });

      expect(createProvider).toHaveBeenCalledWith(
        mockConfig,
        { providerId: 'custom-provider' }
      );
      expect(mockProvider.getToolsetSpec).toHaveBeenCalled();
    });

    test('falls back to provider tool specifications when request omits tools', async () => {
      const body = {
        messages: [{ role: 'user', content: 'Hello there' }],
        stream: false
      };
      const bodyIn = {};

      const fallbackToolset = [
        { type: 'function', function: { name: 'provider_only_tool' } }
      ];

      const mockProvider = {
        getToolsetSpec: jest.fn(() => fallbackToolset),
        supportsReasoningControls: jest.fn(() => false)
      };

      createProvider.mockResolvedValue(mockProvider);

      const mockLLMResponse = {
        choices: [{
          message: { role: 'assistant', content: 'Hello world' },
          finish_reason: 'stop'
        }]
      };

      createOpenAIRequest.mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockLLMResponse)
      });

      await handleToolsJson({
        body,
        bodyIn,
        config: mockConfig,
        res: mockRes,
        req: mockReq,
        persistence: mockPersistence
      });

      expect(createOpenAIRequest).toHaveBeenCalledWith(
        mockConfig,
        expect.objectContaining({
          tools: fallbackToolset,
          tool_choice: 'auto'
        }),
        expect.objectContaining({ providerId: undefined })
      );
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          choices: mockLLMResponse.choices
        })
      );
    });

    test('includes reasoning controls when provider supports them', async () => {
      const body = {
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
        reasoning_effort: 'high',
        verbosity: 1
      };
      const bodyIn = {};

      const mockProvider = {
        getToolsetSpec: jest.fn(() => []),
        supportsReasoningControls: jest.fn(() => true)
      };

      createProvider.mockResolvedValue(mockProvider);

      const mockLLMResponse = {
        choices: [{
          message: { role: 'assistant', content: 'Hello world' },
          finish_reason: 'stop'
        }]
      };

      createOpenAIRequest.mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockLLMResponse)
      });

      await handleToolsJson({
        body,
        bodyIn,
        config: mockConfig,
        res: mockRes,
        req: mockReq,
        persistence: mockPersistence,
        provider: mockProvider
      });

      expect(createOpenAIRequest).toHaveBeenCalledWith(
        mockConfig,
        expect.objectContaining({
          reasoning_effort: 'high',
          verbosity: 1
        }),
        expect.any(Object)
      );
    });
  });
});
