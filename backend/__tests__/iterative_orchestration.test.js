// Tests for unified tool orchestration

import assert from 'node:assert/strict';
import { jest } from '@jest/globals';

import { handleUnifiedToolOrchestration } from '../src/lib/unifiedToolOrchestrator.js';
import { tools as toolRegistry } from '../src/lib/tools.js';
import request from 'supertest';
import { MockUpstream } from '../test_utils/chatProxyTestUtils.js';
import { config } from '../src/env.js';
import express from 'express';
import { chatRouter } from '../src/routes/chat.js';
import { getDb } from '../src/db/index.js';

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
const setupMockFetch = (responses, mock) => {
  let callCount = 0;
  mock.mockImplementation(async (url, options) => {
    const response = responses[callCount++] || responses[responses.length - 1];
    return {
      ok: true,
      json: async () => response
    };
  });
};

describe('Iterative Orchestration', () => {
  // Track all MockUpstream instances for cleanup
  const upstreamInstances = new Set();

  // Setup database configuration for tests
  beforeAll(() => {
    // Configure test environment variables
    process.env.PERSIST_TRANSCRIPTS = 'true';
    process.env.DB_URL = 'file::memory:';
    process.env.DEFAULT_MODEL = 'gpt-3.5-turbo';
    process.env.PORT = '3001';
    process.env.RATE_LIMIT_WINDOW_SEC = '60';
    process.env.RATE_LIMIT_MAX = '50';
    process.env.ALLOWED_ORIGIN = 'http://localhost:3000';

    // Update config object directly since it's already imported
    config.persistence.enabled = true;
    config.persistence.dbUrl = 'file::memory:';
    config.defaultModel = 'gpt-3.5-turbo';
    config.port = 3001;
    config.rate.windowSec = 60;
    config.rate.max = 50;
    config.allowedOrigin = 'http://localhost:3000';
  });

  beforeEach(async () => {
    // Reset database cache for clean state
    const { resetDbCache } = await import('../src/db/index.js');
    resetDbCache();
  });

  afterEach(async () => {
    // Clean up all upstream instances created during tests
    for (const upstream of upstreamInstances) {
      try {
        await upstream.stop();
      } catch (error) {
        console.warn('Error stopping upstream:', error);
      }
    }
    upstreamInstances.clear();

    // Clean up database connections after each test
    const { resetDbCache } = await import('../src/db/index.js');
    resetDbCache();
  });

  afterAll(async () => {
    // Final cleanup - ensure all upstreams are stopped
    for (const upstream of upstreamInstances) {
      try {
        await upstream.stop();
      } catch (error) {
        console.warn('Error in final upstream cleanup:', error);
      }
    }
    upstreamInstances.clear();

    // Clean up environment variables
    delete process.env.PERSIST_TRANSCRIPTS;
    delete process.env.DB_URL;
    delete process.env.DEFAULT_MODEL;
    delete process.env.PORT;
    delete process.env.RATE_LIMIT_WINDOW_SEC;
    delete process.env.RATE_LIMIT_MAX;
    delete process.env.ALLOWED_ORIGIN;
  });

  describe.skip('handleUnifiedToolOrchestration', () => {
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

      const mockHttp = jest.fn();
      setupMockFetch(aiResponses, mockHttp);

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

      await handleUnifiedToolOrchestration({
        body,
        bodyIn,
        config: mockConfig,
        res,
        req,
        ...mockPersistence,
        providerHttp: mockHttp
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

      const mockHttp = jest.fn();
      setupMockFetch(aiResponses, mockHttp);

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

      await handleUnifiedToolOrchestration({
        body,
        bodyIn,
        config: mockConfig,
        res,
        req,
        ...mockPersistence,
        providerHttp: mockHttp
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

      const mockHttp = jest.fn();
      setupMockFetch(aiResponses, mockHttp);

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

      await handleUnifiedToolOrchestration({
        body,
        bodyIn,
        config: mockConfig,
        res,
        req,
        ...mockPersistence,
        providerHttp: mockHttp
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

      const mockHttp = jest.fn();
      setupMockFetch(aiResponses, mockHttp);

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

      await handleUnifiedToolOrchestration({
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

      const mockHttp = jest.fn();
      setupMockFetch(aiResponses, mockHttp);

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
      const orchestrationPromise = handleUnifiedToolOrchestration({
        body,
        bodyIn,
        config: mockConfig,
        res,
        req,
        ...mockPersistence,
        providerHttp: mockHttp
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

  describe('Unified Orchestration (supertest)', () => {
    // Helper to build an express app bound to the chat router
    const makeApp = () => {
      const app = express();
      app.use(express.json());
      app.use(chatRouter);
      return app;
    };

    test('handles single tool call then final JSON via /v1/chat/completions', async () => {
      const upstream = new MockUpstream();
      upstreamInstances.add(upstream); // Track for cleanup
      // Replace default routes with a fresh app so our override takes effect first
      upstream.app = express();
      upstream.app.use(express.json());
      // Simulate: first call returns a tool_call, second returns final message
      let calls = 0;
      upstream.app.post('/v1/chat/completions', (req, res) => {
        calls++;
        if (calls === 1) {
          return res.json({
            id: 'chat_iter_1',
            object: 'chat.completion',
            created: Math.floor(Date.now()/1000),
            model: 'gpt-3.5-turbo',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: 'Thinking…',
                tool_calls: [{ id: 'call_time', type: 'function', function: { name: 'get_time', arguments: '{}' } }]
              },
              finish_reason: null
            }]
          });
        }
        return res.json({
          id: 'chat_iter_final',
          object: 'chat.completion',
          created: Math.floor(Date.now()/1000),
          model: 'gpt-3.5-turbo',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'The current time is 08:30 UTC.', tool_calls: null },
            finish_reason: 'stop'
          }]
        });
      });

      await upstream.start();

      // Point provider config to mock upstream and clear DB providers
      const db = getDb();
      try { db.exec('DELETE FROM providers;'); } catch {}
      const prevBase = config.openaiBaseUrl;
      const prevProvBase = config.providerConfig.baseUrl;
      config.openaiBaseUrl = `${upstream.getUrl()}/v1`;
      config.providerConfig.baseUrl = `${upstream.getUrl()}`;

      try {
        const app = makeApp();
        const res = await request(app)
          .post('/v1/chat/completions')
          .send({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'What time is it?' }],
            tools: [toolRegistry.get_time],
            stream: false,
          });
        assert.equal(res.status, 200);
        // Debug: surface response shape if assertion fails
        // eslint-disable-next-line no-console
        if (!res.body || !res.body.tool_events) console.log('DEBUG unified response', JSON.stringify(res.body));
        // Expect tool_events to include tool_call and tool_output, and final message present
        const ev = res.body.tool_events || [];
        const hasToolCall = ev.some(e => e.type === 'tool_call');
        const hasToolOutput = ev.some(e => e.type === 'tool_output');
        if (!hasToolCall) {
          throw new Error('Should record a tool_call event. Body=' + JSON.stringify(res.body));
        }
        if (!hasToolOutput) {
          throw new Error('Should record a tool_output event. Body=' + JSON.stringify(res.body));
        }
        assert(res.body?.choices?.[0]?.message?.content, 'Should include final assistant message');
      } finally {
        config.openaiBaseUrl = prevBase;
        config.providerConfig.baseUrl = prevProvBase;
        // Note: upstream cleanup handled by afterEach hook
      }
    }, 15000);

    test('handles multiple tool calls in sequence (JSON mode)', async () => {
      const upstream = new MockUpstream();
      upstreamInstances.add(upstream); // Track for cleanup
      upstream.app = express();
      upstream.app.use(express.json());
      let calls = 0;
      upstream.app.post('/v1/chat/completions', (req, res) => {
        calls++;
        if (calls === 1) {
          return res.json({
            id: 'iter_1', object: 'chat.completion', created: Math.floor(Date.now()/1000), model: 'gpt-3.5-turbo',
            choices: [{ index: 0, message: { role: 'assistant', content: 'Getting time…', tool_calls: [ { id: 'c1', type: 'function', function: { name: 'get_time', arguments: '{}' } } ] }, finish_reason: null }]
          });
        }
        if (calls === 2) {
          return res.json({
            id: 'iter_2', object: 'chat.completion', created: Math.floor(Date.now()/1000), model: 'gpt-3.5-turbo',
            choices: [{ index: 0, message: { role: 'assistant', content: 'Searching…', tool_calls: [ { id: 'c2', type: 'function', function: { name: 'web_search', arguments: '{"query":"latest tech"}' } } ] }, finish_reason: null }]
          });
        }
        return res.json({
          id: 'iter_final', object: 'chat.completion', created: Math.floor(Date.now()/1000), model: 'gpt-3.5-turbo',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Here is the summary…', tool_calls: null }, finish_reason: 'stop' }]
        });
      });

      await upstream.start();
      const db = getDb();
      try { db.exec('DELETE FROM providers;'); } catch {}
      const prevBase = config.openaiBaseUrl;
      const prevProvBase = config.providerConfig.baseUrl;
      config.openaiBaseUrl = `${upstream.getUrl()}/v1`;
      config.providerConfig.baseUrl = `${upstream.getUrl()}`;

      try {
        const app = makeApp();
        const res = await request(app)
          .post('/v1/chat/completions')
          .send({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Get time then search latest tech' }],
            tools: [toolRegistry.get_time, toolRegistry.web_search],
            stream: false,
          });
        assert.equal(res.status, 200);
        const ev = res.body.tool_events || [];
        const toolCalls = ev.filter(e => e.type === 'tool_call');
        const toolOutputs = ev.filter(e => e.type === 'tool_output');
        assert(toolCalls.length >= 2, 'Should record multiple tool_call events');
        assert(toolOutputs.length >= 2, 'Should record multiple tool_output events');
      } finally {
        config.openaiBaseUrl = prevBase;
        config.providerConfig.baseUrl = prevProvBase;
        // Note: upstream cleanup handled by afterEach hook
      }
    }, 15000);

    test('handles invalid tool gracefully (JSON mode)', async () => {
      const upstream = new MockUpstream();
      upstreamInstances.add(upstream); // Track for cleanup
      upstream.app = express();
      upstream.app.use(express.json());
      let calls = 0;
      upstream.app.post('/v1/chat/completions', (req, res) => {
        calls++;
        if (calls === 1) {
          return res.json({
            id: 'iter_err', object: 'chat.completion', created: Math.floor(Date.now()/1000), model: 'gpt-3.5-turbo',
            choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [ { id: 'bad', type: 'function', function: { name: 'nonexistent_tool', arguments: '{}' } } ] }, finish_reason: null }]
          });
        }
        return res.json({
          id: 'iter_final', object: 'chat.completion', created: Math.floor(Date.now()/1000), model: 'gpt-3.5-turbo',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Fallback answer', tool_calls: null }, finish_reason: 'stop' }]
        });
      });

      await upstream.start();
      const db = getDb();
      try { db.exec('DELETE FROM providers;'); } catch {}
      const prevBase = config.openaiBaseUrl;
      const prevProvBase = config.providerConfig.baseUrl;
      config.openaiBaseUrl = `${upstream.getUrl()}/v1`;
      config.providerConfig.baseUrl = `${upstream.getUrl()}`;

      try {
        const app = makeApp();
        const res = await request(app)
          .post('/v1/chat/completions')
          .send({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Try a bad tool' }],
            tools: [toolRegistry.get_time],
            stream: false,
          });
        assert.equal(res.status, 200);
        const ev = res.body.tool_events || [];
        const toolOutputs = ev.filter(e => e.type === 'tool_output');
        assert(toolOutputs.length >= 1, 'Should include a tool_output event');
        const hasError = toolOutputs.some(e => String(e.value?.output || '').includes('unknown_tool'));
        assert(hasError, 'Tool output should include unknown_tool error');
      } finally {
        config.openaiBaseUrl = prevBase;
        config.providerConfig.baseUrl = prevProvBase;
        // Note: upstream cleanup handled by afterEach hook
      }
    }, 15000);

    test('respects maximum iterations limit (JSON mode)', async () => {
      const upstream = new MockUpstream();
      upstreamInstances.add(upstream); // Track for cleanup
      upstream.app = express();
      upstream.app.use(express.json());
      // Always returns a tool call to force loop
      upstream.app.post('/v1/chat/completions', (req, res) => {
        return res.json({
          id: 'loop', object: 'chat.completion', created: Math.floor(Date.now()/1000), model: 'gpt-3.5-turbo',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Looping…', tool_calls: [ { id: 'loop_1', type: 'function', function: { name: 'get_time', arguments: '{}' } } ] }, finish_reason: null }]
        });
      });

      await upstream.start();
      const db = getDb();
      try { db.exec('DELETE FROM providers;'); } catch {}
      const prevBase = config.openaiBaseUrl;
      const prevProvBase = config.providerConfig.baseUrl;
      config.openaiBaseUrl = `${upstream.getUrl()}/v1`;
      config.providerConfig.baseUrl = `${upstream.getUrl()}`;

      try {
        const app = makeApp();
        const res = await request(app)
          .post('/v1/chat/completions')
          .send({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Force tool loop' }],
            tools: [toolRegistry.get_time],
            stream: false,
          });
        assert.equal(res.status, 200);
        const ev = res.body.tool_events || [];
        const maxIterMsg = ev.find(e => e.type === 'text' && typeof e.value === 'string' && e.value.includes('Maximum iterations reached'));
        assert(maxIterMsg, 'Should include Maximum iterations reached marker');
      } finally {
        config.openaiBaseUrl = prevBase;
        config.providerConfig.baseUrl = prevProvBase;
        // Note: upstream cleanup handled by afterEach hook
      }
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
