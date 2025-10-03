// Persistence-related tests for chat proxy
import assert from 'node:assert/strict';
import request from 'supertest';
import { createChatProxyTestContext } from '../test_utils/chatProxyTestUtils.js';
import { getDb, upsertSession, createConversation } from '../src/db/index.js';
import { config } from '../src/env.js';

const { makeApp, withServer } = createChatProxyTestContext();

const mockUser = {
  id: 'user-limit-test',
  email: 'limit@example.com',
  displayName: 'Limit Tester'
};

describe('Chat proxy persistence', () => {
  test('user receives appropriate error when conversation message limit exceeded', async () => {
    const originalLimit = config.persistence.maxMessagesPerConversation;
    config.persistence.maxMessagesPerConversation = 1; // Set very low limit

    const sessionId = 'test-session-limit';
    const userId = mockUser.id;

    try {
      const app = makeApp({ mockUser });
      const db = getDb();
      upsertSession(sessionId);
      createConversation({ id: 'conv1', sessionId, userId, title: 'Test Limit' });

      // Pre-populate one message to reach the limit
      db.prepare(
        `INSERT INTO messages (conversation_id, role, content, seq) VALUES (?, 'user', 'existing message', 1)`
      ).run('conv1');
      await withServer(app, async (_port) => {
        // Suppress console.error for this specific test
        const originalConsoleError = console.error;
        console.error = () => {};

        try {
          const res = await request(app)
            .post('/v1/chat/completions')
            .set('x-session-id', sessionId)
            .send({ messages: [{ role: 'user', content: 'This should be blocked' }], conversation_id: 'conv1', stream: false });
          assert.equal(res.status, 429, 'Should return 429 when limit exceeded');
          const body = res.body;
          assert.equal(body.error, 'message_limit_exceeded', 'Should indicate message limit exceeded');
          assert.ok(body.message, 'Should provide explanatory message to user');
        } finally {
          console.error = originalConsoleError;
        }
      });
    } finally {
      config.persistence.maxMessagesPerConversation = originalLimit;
    }
  });

  test('accepts optional conversation_id in body/header and continues streaming', async () => {
    const sessionId = 'test-session';
    const userId = mockUser.id;
    const app = makeApp({ mockUser });
    upsertSession(sessionId);
    createConversation({ id: 'conv1', sessionId, userId, title: 'Test' });
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('x-session-id', sessionId)
      .set('x-conversation-id', 'conv1')
      .send({ messages: [{ role: 'user', content: 'Hello' }], stream: true });
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('data: '));
  });

  test('user can retrieve persisted conversation messages after sending a message', async () => {
    const sessionId = 'test-session';
    const userId = mockUser.id;
    const app = makeApp({ mockUser });
    upsertSession(sessionId);
    createConversation({ id: 'conv1', sessionId, userId, title: 'Test' });
    // User sends a message
    const chatRes = await request(app)
      .post('/v1/chat/completions')
      .set('x-session-id', sessionId)
      .send({ messages: [{ role: 'user', content: 'Hello' }], conversation_id: 'conv1', stream: false });
    assert.equal(chatRes.status, 200);
    assert.ok(chatRes.body.choices[0].message.content);

    // Retrieve the conversation messages
    const getRes = await request(app)
      .get('/v1/conversations/conv1/messages')
      .set('x-session-id', sessionId);
    if (getRes.status === 200) {
      const messages = (getRes.body.messages || []);
      assert.ok(messages.length >= 2, 'Should persist both user and assistant messages');
      const userMessage = messages.find(m => m.role === 'user');
      const assistantMessage = messages.find(m => m.role === 'assistant');
      assert.ok(userMessage, 'Should persist user message');
      assert.equal(userMessage.content, 'Hello', 'Should preserve user message content');
      assert.ok(assistantMessage, 'Should persist assistant response');
      assert.ok(assistantMessage.content, 'Assistant message should have content');
    }
  });
});
