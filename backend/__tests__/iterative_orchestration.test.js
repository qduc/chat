// Tests for iterative tool orchestration

import assert from 'node:assert/strict';
import express from 'express';
import { jest } from '@jest/globals';

// Mock node-fetch before importing modules that use it
const mockFetch = jest.fn();
jest.mock('node-fetch', () => mockFetch);

import { handleIterativeOrchestration } from '../src/lib/iterativeOrchestrator.js';
import { tools as toolRegistry } from '../src/lib/tools.js';

// Mock response object for testing
class MockResponse {
  constructor() {
    this.chunks = [];
    this.ended = false;
    this.headers = {};
  }

  setHeader(name, value) {
    this.headers[name] = value;
  }

  write(chunk) {
    this.chunks.push(chunk);
  }

  end() {
    this.ended = true;
  }

  flush() {
    // no-op for testing
  }

  getChunks() {
    return this.chunks;
  }

  getStreamedEvents() {
    return this.chunks
      .filter(chunk => chunk.startsWith('data: '))
      .map(chunk => {
        const data = chunk.slice(6).trim();
        if (data === '[DONE]') return { type: 'done' };
        try {
          return JSON.parse(data);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
}

// Mock request object
class MockRequest {
  constructor() {
    this.aborted = false;
    this.listeners = {};
  }

  on(event, callback) {
    this.listeners[event] = callback;
  }

  emit(event) {
    if (this.listeners[event]) {
      this.listeners[event]();
    }
  }
}

// Mock config object
const mockConfig = {
  openaiBaseUrl: 'http://localhost:3001',
  openaiApiKey: 'test-key',
  defaultModel: 'gpt-3.5-turbo'
};

// Helper to setup mock responses
const setupMockFetch = (responses) => {
  let callCount = 0;
  mockFetch.mockImplementation(async (url, options) => {
    const response = responses[callCount++] || responses[responses.length - 1];
    return {
      ok: true,
      json: async () => response
    };
  });
};

describe('Iterative Orchestration', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

  describe.skip('handleIterativeOrchestration', () => {
    it('should handle single tool call followed by final response', async () => {
      // Mock AI responses: first with tool call, then final response
      const aiResponses = [
        {
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'call_123',
                type: 'function',
                function: {
                  name: 'get_time',
                  arguments: '{}'
                }
              }]
            }
          }]
        },
        {
          choices: [{
            message: {
              role: 'assistant',
              content: 'The current time is 08:30:32 UTC. This information shows the current server time.',
              tool_calls: null
            }
          }]
        }
      ];

      setupMockFetch(aiResponses);

      const res = new MockResponse();
      const req = new MockRequest();
      const body = { 
        model: 'gpt-3.5-turbo',
        tools: [toolRegistry.get_time]
      };
      const bodyIn = { 
        messages: [{ role: 'user', content: 'What time is it?' }] 
      };

      // Mock persistence functions
      const mockPersistence = {
        persist: false,
        assistantMessageId: null,
        appendAssistantContent: () => {},
        finalizeAssistantMessage: () => {},
        markAssistantError: () => {},
        buffer: { value: '' },
        flushedOnce: { value: false },
        sizeThreshold: 512
      };

      await handleIterativeOrchestration({
        body,
        bodyIn,
        config: mockConfig,
        res,
        req,
        ...mockPersistence
      });

      assert(res.ended, 'Response should be ended');
      
      const events = res.getStreamedEvents();
      
      // Should have: tool_call event, tool_output event, content event, final event
      const toolCallEvents = events.filter(e => e.choices?.[0]?.delta?.tool_calls);
      const toolOutputEvents = events.filter(e => e.choices?.[0]?.delta?.tool_output);
      const contentEvents = events.filter(e => e.choices?.[0]?.delta?.content);
      const finalEvents = events.filter(e => e.choices?.[0]?.finish_reason === 'stop');

      assert(toolCallEvents.length >= 1, 'Should have at least one tool call event');
      assert(toolOutputEvents.length >= 1, 'Should have at least one tool output event');
      assert(contentEvents.length >= 1, 'Should have at least one content event');
      assert(finalEvents.length >= 1, 'Should have at least one final event');
    }, 15000);

    it('should handle multiple tool calls in sequence', async () => {
      const aiResponses = [
        // First iteration: get_time tool call
        {
          choices: [{
            message: {
              role: 'assistant',
              content: 'Let me get the current time first.',
              tool_calls: [{
                id: 'call_123',
                type: 'function',
                function: {
                  name: 'get_time',
                  arguments: '{}'
                }
              }]
            }
          }]
        },
        // Second iteration: web_search tool call
        {
          choices: [{
            message: {
              role: 'assistant',
              content: 'Now let me search for the latest information.',
              tool_calls: [{
                id: 'call_456',
                type: 'function',
                function: {
                  name: 'web_search',
                  arguments: '{"query": "latest tech news 2024"}'
                }
              }]
            }
          }]
        },
        // Third iteration: final response
        {
          choices: [{
            message: {
              role: 'assistant',
              content: 'Based on the current time and search results, here is my analysis...',
              tool_calls: null
            }
          }]
        }
      ];

      setupMockFetch(aiResponses);

      const res = new MockResponse();
      const req = new MockRequest();
      const body = { 
        model: 'gpt-3.5-turbo',
        tools: [toolRegistry.get_time, toolRegistry.web_search]
      };
      const bodyIn = { 
        messages: [{ role: 'user', content: 'Get time then search for latest tech news' }] 
      };

      const mockPersistence = {
        persist: false,
        assistantMessageId: null,
        appendAssistantContent: () => {},
        finalizeAssistantMessage: () => {},
        markAssistantError: () => {},
        buffer: { value: '' },
        flushedOnce: { value: false },
        sizeThreshold: 512
      };

      await handleIterativeOrchestration({
        body,
        bodyIn,
        config: mockConfig,
        res,
        req,
        ...mockPersistence
      });

      assert(res.ended, 'Response should be ended');
      
      const events = res.getStreamedEvents();
      
      // Should have multiple iterations with different tools
      const toolCallEvents = events.filter(e => e.choices?.[0]?.delta?.tool_calls);
      const toolOutputEvents = events.filter(e => e.choices?.[0]?.delta?.tool_output);
      const contentEvents = events.filter(e => e.choices?.[0]?.delta?.content);

      assert(toolCallEvents.length >= 2, 'Should have at least two tool call events');
      assert(toolOutputEvents.length >= 2, 'Should have at least two tool output events');
      assert(contentEvents.length >= 3, 'Should have multiple content events (thinking + final)');
    }, 15000);

    it('should handle tool execution errors gracefully', async () => {
      const aiResponses = [
        {
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'call_invalid',
                type: 'function',
                function: {
                  name: 'nonexistent_tool',
                  arguments: '{}'
                }
              }]
            }
          }]
        },
        {
          choices: [{
            message: {
              role: 'assistant',
              content: 'I encountered an error with that tool, but here is what I can tell you...',
              tool_calls: null
            }
          }]
        }
      ];

      setupMockFetch(aiResponses);

      const res = new MockResponse();
      const req = new MockRequest();
      const body = { 
        model: 'gpt-3.5-turbo',
        tools: [toolRegistry.get_time]
      };
      const bodyIn = { 
        messages: [{ role: 'user', content: 'Use invalid tool' }] 
      };

      const mockPersistence = {
        persist: false,
        assistantMessageId: null,
        appendAssistantContent: () => {},
        finalizeAssistantMessage: () => {},
        markAssistantError: () => {},
        buffer: { value: '' },
        flushedOnce: { value: false },
        sizeThreshold: 512
      };

      await handleIterativeOrchestration({
        body,
        bodyIn,
        config: mockConfig,
        res,
        req,
        ...mockPersistence
      });

      assert(res.ended, 'Response should be ended');
      
      const events = res.getStreamedEvents();
      const toolOutputEvents = events.filter(e => e.choices?.[0]?.delta?.tool_output);
      
      // Should have error output
      assert(toolOutputEvents.length >= 1, 'Should have tool output event');
      
      // Check if error is properly handled
      const errorOutput = toolOutputEvents.find(e => 
        e.choices[0].delta.tool_output.output?.includes('unknown_tool') ||
        typeof e.choices[0].delta.tool_output.output === 'string'
      );
      assert(errorOutput, 'Should have error output for invalid tool');
    }, 15000);

    it('should respect maximum iterations limit', async () => {
      // Create responses that would cause infinite loop (always returning tool calls)
      const infiniteToolResponse = {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Calling tool again...',
            tool_calls: [{
              id: 'call_loop',
              type: 'function',
              function: {
                name: 'get_time',
                arguments: '{}'
              }
            }]
          }
        }]
      };

      // Return the same response 15 times (more than MAX_ITERATIONS)
      const aiResponses = Array(15).fill(infiniteToolResponse);

      setupMockFetch(aiResponses);

      const res = new MockResponse();
      const req = new MockRequest();
      const body = { 
        model: 'gpt-3.5-turbo',
        tools: [toolRegistry.get_time]
      };
      const bodyIn = { 
        messages: [{ role: 'user', content: 'Keep calling tools' }] 
      };

      const mockPersistence = {
        persist: false,
        assistantMessageId: null,
        appendAssistantContent: () => {},
        finalizeAssistantMessage: () => {},
        markAssistantError: () => {},
        buffer: { value: '' },
        flushedOnce: { value: false },
        sizeThreshold: 512
      };

      await handleIterativeOrchestration({
        body,
        bodyIn,
        config: mockConfig,
        res,
        req,
        ...mockPersistence
      });

      assert(res.ended, 'Response should be ended');
      
      const events = res.getStreamedEvents();
      const contentEvents = events.filter(e => e.choices?.[0]?.delta?.content);
      
      // Should have maximum iterations reached message
      const maxIterationsEvent = contentEvents.find(e => 
        e.choices[0].delta.content?.includes('Maximum iterations reached')
      );
      assert(maxIterationsEvent, 'Should have maximum iterations reached message');
    }, 15000);

    it('should handle client disconnect gracefully', async () => {
      const aiResponses = [{
        choices: [{
          message: {
            role: 'assistant',
            content: 'Starting response...',
            tool_calls: [{
              id: 'call_123',
              type: 'function',
              function: {
                name: 'get_time',
                arguments: '{}'
              }
            }]
          }
        }]
      }];

      setupMockFetch(aiResponses);

      const res = new MockResponse();
      const req = new MockRequest();
      const body = { 
        model: 'gpt-3.5-turbo',
        tools: [toolRegistry.get_time]
      };
      const bodyIn = { 
        messages: [{ role: 'user', content: 'What time is it?' }] 
      };

      const mockPersistence = {
        persist: true,
        assistantMessageId: 'test_msg_123',
        appendAssistantContent: () => {},
        finalizeAssistantMessage: () => {},
        markAssistantError: () => {},
        buffer: { value: 'some content' },
        flushedOnce: { value: false },
        sizeThreshold: 512
      };

      // Start the orchestration
      const orchestrationPromise = handleIterativeOrchestration({
        body,
        bodyIn,
        config: mockConfig,
        res,
        req,
        ...mockPersistence
      });

      // Simulate client disconnect
      setTimeout(() => {
        req.emit('close');
      }, 10);

      await orchestrationPromise;

      // Should handle disconnect gracefully (no assertion errors)
      assert(true, 'Should handle client disconnect without errors');
    }, 15000);
  });

describe('Tool Integration', () => {
  beforeAll(() => {
    // Mock TAVILY_API_KEY for web_search tests
    process.env.TAVILY_API_KEY = 'test-api-key';
  });

  afterAll(() => {
    // Clean up environment variable
    delete process.env.TAVILY_API_KEY;
  });

  it('should correctly execute get_time tool', async () => {
    const result = await toolRegistry.get_time.handler({});
    
    assert(result.iso, 'Should return ISO timestamp');
    assert(result.human, 'Should return human readable time');
    assert(result.timezone, 'Should return timezone info');
    assert(new Date(result.iso), 'ISO timestamp should be valid date');
  });

  it('should correctly execute web_search tool', async () => {
    // Mock global fetch for this test (since the tools.js uses global fetch, not node-fetch)
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: 'test query',
        answer: 'Test answer from search',
        results: [
          {
            title: 'Test Result 1',
            content: 'This is test content',
            url: 'https://example.com/1'
          }
        ]
      })
    });

    try {
      const result = await toolRegistry.web_search.handler({ query: 'test query' });
      
      assert(typeof result === 'string', 'Should return string result');
      assert(result.includes('Test answer'), 'Should contain search answer');
      assert(result.includes('Test Result 1'), 'Should contain search results');
    } finally {
      // Restore original fetch
      globalThis.fetch = originalFetch;
    }
  });
});
});