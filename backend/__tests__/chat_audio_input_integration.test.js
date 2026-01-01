// Integration tests for audio input (text + input_audio) through chat completions API
import assert from 'node:assert/strict';
import request from 'supertest';
import { createChatProxyTestContext } from '../test_utils/chatProxyTestUtils.js';
import { getDb, upsertSession, createConversation, getMessagesPage } from '../src/db/index.js';

const mockUser = { id: 'test-user-audio', email: 'audio@example.com' };
const { upstream, makeApp } = createChatProxyTestContext();

describe('Audio Input Integration Tests', () => {
  const sessionId = 'session-audio-integration';

  beforeEach(() => {
    const db = getDb();
    db.exec('DELETE FROM messages');
    db.exec('DELETE FROM conversations');
    upsertSession(sessionId, { userId: mockUser.id });
  });

  test('POST /v1/chat/completions stores and retrieves mixed content with audio', async () => {
    const app = makeApp({ mockUser });
    const conversationId = 'conv-audio-test-1';
    createConversation({ id: conversationId, sessionId, userId: mockUser.id });

    const mixedContent = [
      { type: 'text', text: 'Please transcribe:' },
      {
        type: 'input_audio',
        input_audio: {
          // small dummy base64 payload
          data: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=',
          format: 'wav',
        },
      },
    ];

    const chatRes = await request(app)
      .post('/v1/chat/completions')
      .set('x-session-id', sessionId)
      .send({
        messages: [{ role: 'user', content: mixedContent }],
        conversation_id: conversationId,
        stream: false,
      });

    assert.equal(chatRes.status, 200);

    const messagesPage = getMessagesPage({ conversationId });
    const userMessage = messagesPage.messages.find((m) => m.role === 'user');
    assert.ok(userMessage);
    assert.ok(Array.isArray(userMessage.content));
    assert.equal(userMessage.content.length, 2);
    assert.equal(userMessage.content[0].type, 'text');
    assert.equal(userMessage.content[1].type, 'input_audio');
    assert.equal(userMessage.content[1].input_audio.format, 'wav');
    assert.ok(typeof userMessage.content[1].input_audio.data === 'string');
  });

  test('Audio content passes through to upstream provider', async () => {
    const app = makeApp({ mockUser });
    const conversationId = 'conv-audio-upstream';
    createConversation({ id: conversationId, sessionId, userId: mockUser.id });

    const mixedContent = [
      { type: 'text', text: 'Transcribe this:' },
      {
        type: 'input_audio',
        input_audio: { data: 'AAAA', format: 'wav' },
      },
    ];

    await request(app)
      .post('/v1/chat/completions')
      .set('x-session-id', sessionId)
      .send({
        messages: [{ role: 'user', content: mixedContent }],
        conversation_id: conversationId,
        stream: false,
      });

    const lastRequest = upstream.lastChatRequestBody;
    assert.ok(lastRequest);
    const userMessage = lastRequest.messages.find((m) => m.role === 'user');
    assert.ok(userMessage);
    assert.ok(Array.isArray(userMessage.content));

    const audioPart = userMessage.content.find((p) => p.type === 'input_audio');
    assert.ok(audioPart, 'Upstream should receive input_audio part');
    assert.equal(audioPart.input_audio.format, 'wav');
    assert.equal(audioPart.input_audio.data, 'AAAA');
  });
});
