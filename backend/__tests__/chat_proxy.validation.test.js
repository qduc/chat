// Behavior tests for reasoning controls validation on chat proxy
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { chatRouter } from '../src/routes/chat.js';
import { createChatProxyTestContext } from '../test_utils/chatProxyTestUtils.js';

const { makeApp, withServer } = createChatProxyTestContext();

// Mock user for authentication (Phase 4: all requests require auth)
const mockUser = { id: 'test-user-123', email: 'test@example.com' };

describe('Chat proxy validation', () => {
  test('rejects invalid reasoning_effort value when model supports reasoning', async () => {
    const app = makeApp({ mockUser });
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'gpt-5.1-mini', messages: [{ role: 'user', content: 'Hi' }], reasoning_effort: 'extreme', stream: false });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request_error');
  });

  test('strips reasoning controls when model does not support reasoning', async () => {
    // Should proceed with 200 even if verbosity value is invalid for non-gpt-5 models
    const app = makeApp({ mockUser });
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'Hi' }], verbosity: 'invalid-value', stream: false });
    assert.equal(res.status, 200);
  });
});
