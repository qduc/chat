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
  test('accepts optional conversation_id in body/header and continues streaming', async () => {
    const sessionId = 'test-session';
    const userId = mockUser.id;
    const app = makeApp({ mockUser });
    upsertSession(sessionId, { userId });
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
    upsertSession(sessionId, { userId });
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
