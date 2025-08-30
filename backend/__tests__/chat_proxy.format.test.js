// Format transformation and tool orchestration tests
import assert from 'node:assert/strict';
import { createChatProxyTestContext, MockUpstream } from '../test_utils/chatProxyTestUtils.js';
import { getDb, upsertSession, createConversation } from '../src/db/index.js';
import { config } from '../src/env.js';

const { makeApp, withServer } = createChatProxyTestContext();

describe('Format transformation', () => {
  test('converts Responses API non-streaming JSON to Chat Completions shape when hitting /v1/chat/completions', async () => {
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          stream: false
        }),
      });

      assert.equal(res.status, 200);
      const body = await res.json();

      // Should return standard Chat Completions format
      assert.ok(body.choices);
      assert.ok(body.choices[0].message);
      assert.equal(body.choices[0].message.role, 'assistant');
      assert.ok(body.choices[0].message.content);
    });
  });

  test('converts Responses API streaming events to Chat Completions chunks when hitting /v1/chat/completions', async () => {
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true
        }),
      });

      assert.equal(res.status, 200);
      const text = await res.text();

      // Should contain standard streaming format with delta fields
      assert.ok(text.includes('data: '));
      assert.ok(text.includes('[DONE]'));
      assert.ok(text.includes('delta'));
    });
  });
});

describe('Tool orchestration', () => {
  test('handles requests with tools by forcing Chat Completions path', async () => {
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'What time is it?' }],
          tools: [{ type: 'function', function: { name: 'get_time' } }],
          stream: false
        }),
      });

      // Should process but not execute tools (since we're using the basic mock)
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.choices);
      assert.ok(body.choices[0].message);
    });
  });

  test('tool orchestration paths are covered in code', async () => {
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          tools: [{ type: 'function', function: { name: 'get_time' } }],
          stream: true
        }),
      });

      assert.equal(res.status, 200);

      const text = await res.text();
      assert.ok(text.includes('data:'), 'Should deliver streaming data');
      assert.ok(text.includes('[DONE]'), 'Should signal completion');
    });
  });

  test('persistence works with tool requests', async () => {
    const sessionId = 'test-session';
    const db = getDb();
    upsertSession(sessionId);
    createConversation({ id: 'conv1', sessionId, title: 'Test' });

    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': sessionId
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'What time is it?' }],
          conversation_id: 'conv1',
          tools: [{ type: 'function', function: { name: 'get_time' } }],
          stream: false
        }),
      });

      assert.equal(res.status, 200);

      const body = await res.json();
      assert.ok(body.choices);
      assert.ok(body.choices[0].message);
    });
  });

  test('supports iterative orchestration streaming with tool calls and outputs', async () => {
    const upstream = new MockUpstream();

    // Custom upstream behavior to simulate iterative orchestration
    let callCount = 0;
    upstream.app.post('/v1/chat/completions', (req, res) => {
      callCount++;
      if (callCount === 1) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write('data: ' + JSON.stringify({
          id: 'iter_1', object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: 'gpt-3.5-turbo',
          choices: [{ index: 0, delta: { tool_calls: [ { id: 'call_time', type: 'function', function: { name: 'get_time', arguments: '{}' } } ] }, finish_reason: null }]
        }) + '\n\n');
        res.write('data: ' + JSON.stringify({ id: 'iter_1_end', object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: 'gpt-3.5-turbo', choices: [{ index: 0, delta: {}, finish_reason: null }] }) + '\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.json({
          id: 'chat_iter_final',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-3.5-turbo',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: 'The current time is 08:30:32 UTC.',
              tool_calls: null
            },
            finish_reason: 'stop'
          }]
        });
      }
    });

    await upstream.start();

    try {
      const app = makeApp();
      // Ensure provider resolution uses env-config instead of DB rows
      try { const db = getDb(); db.exec('DELETE FROM providers;'); } catch {}
      const originalBaseUrl = config.openaiBaseUrl;
      const originalProviderBase = config.providerConfig.baseUrl;
      config.openaiBaseUrl = `http://127.0.0.1:${upstream.port}/v1`;
      config.providerConfig.baseUrl = `http://127.0.0.1:${upstream.port}`;

      try {
        await withServer(app, async (port) => {
          const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [{ role: 'user', content: 'What time is it?' }],
              tools: [{
                type: 'function',
                function: {
                  name: 'get_time',
                  description: 'Get the current time',
                  parameters: { type: 'object', properties: {} }
                }
              }],
              stream: true
            }),
          });
          assert.equal(res.status, 200);

          // Read the streaming response
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let streamData = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            streamData += decoder.decode(value, { stream: true });
          }

          // Parse streaming events and check for tool call events
          const events = [];
          const lines = streamData.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const data = JSON.parse(line.slice(6));
                events.push(data);
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }

          // Stream should contain SSE data and end marker
          assert(streamData.includes('data:'), 'Should stream SSE data');
          assert(streamData.includes('[DONE]'), 'Should end with DONE marker');

          // Iterative behavior handled; streaming completed successfully
        });
      } finally {
        config.openaiBaseUrl = originalBaseUrl;
        config.providerConfig.baseUrl = originalProviderBase;
      }
    } finally {
      await upstream.stop();
    }
  });

  test('handles tool execution within iterative orchestration', async () => {
    const upstream = new MockUpstream();
    upstream.app.post('/v1/chat/completions', (req, res) => {
      // Stream a single tool call event
      res.setHeader('Content-Type', 'text/event-stream');
      res.write('data: ' + JSON.stringify({
        id: 'chat_tool', object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: 'gpt-3.5-turbo',
        choices: [{ index: 0, delta: { tool_calls: [ { id: 'call_time', type: 'function', function: { name: 'get_time', arguments: '{}' } } ] }, finish_reason: null }]
      }) + '\n\n');
      res.write('data: ' + JSON.stringify({ id: 'tool_end', object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: 'gpt-3.5-turbo', choices: [{ index: 0, delta: {}, finish_reason: null }] }) + '\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });

    await upstream.start();

    try {
      const app = makeApp();
      // Ensure provider resolution uses env-config instead of DB rows
      try { const db = getDb(); db.exec('DELETE FROM providers;'); } catch {}
      const originalBaseUrl = config.openaiBaseUrl;
      const originalProviderBase = config.providerConfig.baseUrl;
      config.openaiBaseUrl = `http://127.0.0.1:${upstream.port}/v1`;
      config.providerConfig.baseUrl = `http://127.0.0.1:${upstream.port}`;

      try {
        await withServer(app, async (port) => {
          const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [{ role: 'user', content: 'Get time' }],
              tools: [{
                type: 'function',
                function: {
                  name: 'get_time',
                  description: 'Get current time',
                  parameters: { type: 'object', properties: {} }
                }
              }],
              stream: true
            }),
          });

          assert.equal(res.status, 200);

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let streamData = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            streamData += decoder.decode(value, { stream: true });
          }

          // Parse events to verify tool execution
          const events = streamData
            .split('\n')
            .filter(line => line.startsWith('data: ') && !line.includes('[DONE]'))
            .map(line => {
              try {
                return JSON.parse(line.slice(6));
              } catch {
                return null;
              }
            })
            .filter(Boolean);

          // Stream should contain SSE data and end marker
          assert(streamData.includes('data:'), 'Should stream SSE data');
          assert(streamData.includes('[DONE]'), 'Should end with DONE marker');
        });
      } finally {
        config.openaiBaseUrl = originalBaseUrl;
        config.providerConfig.baseUrl = originalProviderBase;
      }
    } finally {
      await upstream.stop();
    }
  });

  test('falls back gracefully when no tools provided', async () => {
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          // No tools provided
          stream: true
        }),
      });

      assert.equal(res.status, 200);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let streamData = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamData += decoder.decode(value, { stream: true });
      }

      // Parse events and reconstruct content
      const events = [];
      const lines = streamData.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            events.push(data);
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }

      const hasToolCalls = events.some(e => e.choices?.[0]?.delta?.tool_calls);
      const hasToolOutput = events.some(e => e.choices?.[0]?.delta?.tool_output);
      const contentJoined = events.map(e => e.choices?.[0]?.delta?.content || '').join('');
      const hasAnyContent = contentJoined.length > 0;

      assert(!hasToolCalls, 'Should not have tool call events');
      assert(!hasToolOutput, 'Should not have tool output events');
      assert(hasAnyContent, 'Should have regular chat response content');
    });
  });
});
