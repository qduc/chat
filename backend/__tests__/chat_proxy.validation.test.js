// Behavior tests for reasoning controls validation on chat proxy
import assert from 'node:assert/strict';
import express from 'express';
import { chatRouter } from '../src/routes/chat.js';
import { createChatProxyTestContext } from '../test_utils/chatProxyTestUtils.js';

const { makeApp, withServer } = createChatProxyTestContext();

describe('Chat proxy validation', () => {
  test('rejects invalid reasoning_effort value when model supports reasoning', async () => {
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5.1-mini',
          messages: [{ role: 'user', content: 'Hi' }],
          reasoning_effort: 'extreme', // invalid
          stream: false
        }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'invalid_request_error');
    });
  });

  test('strips reasoning controls when model does not support reasoning', async () => {
    // Should proceed with 200 even if verbosity value is invalid for non-gpt-5 models
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hi' }],
          verbosity: 'invalid-value', // should be ignored
          stream: false
        }),
      });
      // Mock upstream is configured; request should succeed and ignore verbosity
      assert.equal(res.status, 200);
    });
  });
});

