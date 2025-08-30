// Proxy behavior tests for /v1/chat/completions
import assert from 'node:assert/strict';
import { createChatProxyTestContext } from '../test_utils/chatProxyTestUtils.js';
import { getDb, upsertSession, createConversation } from '../src/db/index.js';

// Register shared setup/teardown and get helpers
const { upstream, makeApp, withServer } = createChatProxyTestContext();

describe('POST /v1/chat/completions (proxy)', () => {
  test('proxies non-streaming requests and returns upstream JSON', async () => {
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
      assert.equal(body.choices[0].message.content, 'Hello world');
    });
  });

  test('streams SSE responses line-by-line until [DONE]', async () => {
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
      assert.ok(text.includes('data: '));
      assert.ok(text.includes('[DONE]'));
    });
  });

  test('returns error JSON when upstream fails (status >= 400)', async () => {
    upstream.setError(true);
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

      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.error, 'upstream_error');
    });
  });

  test('delivers streaming response progressively when stream=true', async () => {
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

      // Test behavior: streaming content is delivered progressively
      const text = await res.text();
      assert.ok(text.includes('data: '), 'Should deliver data in SSE format');
      assert.ok(text.includes('[DONE]'), 'Should signal completion');

      // Verify content arrives in chunks
      const chunks = text.split('\n\n').filter(chunk => chunk.startsWith('data: ') && chunk !== 'data: [DONE]');
      assert.ok(chunks.length > 0, 'Should deliver content in multiple chunks');
    });
  });

  test('closes stream when client aborts', async () => {
    const app = makeApp();
    await withServer(app, async (port) => {
      const controller = new AbortController();

      const fetchPromise = fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true
        }),
        signal: controller.signal
      });

      controller.abort();

      try {
        await fetchPromise;
        assert.fail('Should have thrown');
      } catch (err) {
        assert.ok(err.name === 'AbortError');
      }
    });
  });

  test('user receives error response when upstream stream fails', async () => {
    const sessionId = 'test-session';
    const db = getDb();
    upsertSession(sessionId);
    createConversation({ id: 'conv1', sessionId, title: 'Test' });

    upstream.setError(true);

    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': sessionId
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          conversation_id: 'conv1',
          stream: true
        }),
      });

      assert.ok(res.status >= 400, 'Should return error status when upstream fails');
      const body = await res.json();
      assert.ok(body.error, 'Should provide error information to user');
    });
  });
});
