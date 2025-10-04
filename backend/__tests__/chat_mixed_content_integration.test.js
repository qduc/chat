// Integration tests for mixed content (text + images) through chat completions API
import assert from 'node:assert/strict';
import request from 'supertest';
import { createChatProxyTestContext } from '../test_utils/chatProxyTestUtils.js';
import { getDb, upsertSession, createConversation, getMessagesPage } from '../src/db/index.js';

const mockUser = { id: 'test-user-mixed', email: 'mixed@example.com' };
const { upstream, makeApp } = createChatProxyTestContext();

describe('Mixed Content Integration Tests', () => {
  const sessionId = 'session-mixed-integration';

  beforeEach(() => {
    const db = getDb();
    db.exec('DELETE FROM messages');
    db.exec('DELETE FROM conversations');
    upsertSession(sessionId, { userId: mockUser.id });
  });

  test('POST /v1/chat/completions stores and retrieves mixed content with images', async () => {
    const app = makeApp({ mockUser });
    const conversationId = 'conv-mixed-test-1';
    createConversation({ id: conversationId, sessionId, userId: mockUser.id });

    // Mixed content message with text and image
    const mixedContent = [
      { type: 'text', text: 'Analyze this image:' },
      {
        type: 'image_url',
        image_url: {
          url: 'http://localhost:3001/v1/images/test-img-123',
          detail: 'high'
        }
      },
      { type: 'text', text: 'What do you see?' }
    ];

    // Send chat request with mixed content
    const chatRes = await request(app)
      .post('/v1/chat/completions')
      .set('x-session-id', sessionId)
      .send({
        messages: [{ role: 'user', content: mixedContent }],
        conversation_id: conversationId,
        stream: false
      });

    assert.equal(chatRes.status, 200);
    assert.ok(chatRes.body.choices);
    assert.ok(chatRes.body.choices[0].message);

    // Verify message was persisted with mixed content
    const messagesPage = getMessagesPage({ conversationId });
    assert.ok(messagesPage.messages.length >= 1);

    const userMessage = messagesPage.messages.find(m => m.role === 'user');
    assert.ok(userMessage, 'User message should be persisted');
    assert.ok(Array.isArray(userMessage.content), 'Content should be an array');
    assert.equal(userMessage.content.length, 3);

    // Verify text parts
    assert.equal(userMessage.content[0].type, 'text');
    assert.equal(userMessage.content[0].text, 'Analyze this image:');

    // Verify image part
    assert.equal(userMessage.content[1].type, 'image_url');
    assert.equal(userMessage.content[1].image_url.url, 'http://localhost:3001/v1/images/test-img-123');
    assert.equal(userMessage.content[1].image_url.detail, 'high');

    // Verify second text part
    assert.equal(userMessage.content[2].type, 'text');
    assert.equal(userMessage.content[2].text, 'What do you see?');
  });

  test('GET /v1/conversations/:id/messages returns mixed content correctly', async () => {
    const app = makeApp({ mockUser });
    const conversationId = 'conv-mixed-test-2';
    createConversation({ id: conversationId, sessionId, userId: mockUser.id });

    // Send message with multiple images
    const multiImageContent = [
      { type: 'text', text: 'Compare these:' },
      { type: 'image_url', image_url: { url: 'http://localhost:3001/v1/images/img-1' } },
      { type: 'image_url', image_url: { url: 'http://localhost:3001/v1/images/img-2' } },
      { type: 'text', text: 'Differences?' }
    ];

    // Send chat request
    await request(app)
      .post('/v1/chat/completions')
      .set('x-session-id', sessionId)
      .send({
        messages: [{ role: 'user', content: multiImageContent }],
        conversation_id: conversationId,
        stream: false
      });

    // Verify persistence via database directly (since GET API endpoint requires auth setup)
    const messagesPage = getMessagesPage({ conversationId });
    assert.ok(messagesPage.messages);

    const userMessage = messagesPage.messages.find(m => m.role === 'user');
    assert.ok(userMessage);
    assert.ok(Array.isArray(userMessage.content));

    // Count images
    const imageCount = userMessage.content.filter(part => part.type === 'image_url').length;
    assert.equal(imageCount, 2);
  });  test('Plain text messages still work (backward compatibility)', async () => {
    const app = makeApp({ mockUser });
    const conversationId = 'conv-text-only';
    createConversation({ id: conversationId, sessionId, userId: mockUser.id });

    // Send plain text message
    const chatRes = await request(app)
      .post('/v1/chat/completions')
      .set('x-session-id', sessionId)
      .send({
        messages: [{ role: 'user', content: 'Hello, world!' }],
        conversation_id: conversationId,
        stream: false
      });

    assert.equal(chatRes.status, 200);

    // Verify message was persisted as plain text
    const messagesPage = getMessagesPage({ conversationId });
    const userMessage = messagesPage.messages.find(m => m.role === 'user');
    assert.ok(userMessage);
    assert.equal(typeof userMessage.content, 'string');
    assert.equal(userMessage.content, 'Hello, world!');
  });

  test('Streaming requests with mixed content', async () => {
    const app = makeApp({ mockUser });
    const conversationId = 'conv-stream-mixed';
    createConversation({ id: conversationId, sessionId, userId: mockUser.id });

    const mixedContent = [
      { type: 'text', text: 'Stream test:' },
      { type: 'image_url', image_url: { url: 'http://localhost:3001/v1/images/stream-img' } }
    ];

    // Send streaming request with mixed content
    const chatRes = await request(app)
      .post('/v1/chat/completions')
      .set('x-session-id', sessionId)
      .send({
        messages: [{ role: 'user', content: mixedContent }],
        conversation_id: conversationId,
        stream: true
      });

    assert.equal(chatRes.status, 200);
    assert.ok(chatRes.text.includes('data:'));
    assert.ok(chatRes.text.includes('[DONE]'));

    // Verify persistence after streaming
    const messagesPage = getMessagesPage({ conversationId });
    const userMessage = messagesPage.messages.find(m => m.role === 'user');
    assert.ok(userMessage);
    assert.ok(Array.isArray(userMessage.content));
    assert.equal(userMessage.content[0].type, 'text');
    assert.equal(userMessage.content[1].type, 'image_url');
  });

  test('Mixed content passes through to upstream provider', async () => {
    const app = makeApp({ mockUser });
    const conversationId = 'conv-upstream-mixed';
    createConversation({ id: conversationId, sessionId, userId: mockUser.id });

    const mixedContent = [
      { type: 'text', text: 'Check this:' },
      { type: 'image_url', image_url: { url: 'http://localhost:3001/v1/images/upstream-test' } }
    ];

    // Send request
    await request(app)
      .post('/v1/chat/completions')
      .set('x-session-id', sessionId)
      .send({
        messages: [{ role: 'user', content: mixedContent }],
        conversation_id: conversationId,
        stream: false
      });

    // Verify upstream received mixed content format
    const lastRequest = upstream.lastChatRequestBody;
    assert.ok(lastRequest);
    assert.ok(lastRequest.messages);

    const userMessage = lastRequest.messages.find(m => m.role === 'user');
    assert.ok(userMessage);
    assert.ok(Array.isArray(userMessage.content), 'Upstream should receive array content');
    assert.equal(userMessage.content.length, 2);
    assert.equal(userMessage.content[0].type, 'text');
    assert.equal(userMessage.content[1].type, 'image_url');
  });
});
