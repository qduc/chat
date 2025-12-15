import http from 'node:http';
import request from 'supertest';
import { getDb, upsertSession } from '../src/db/index.js';
import { createChatProxyTestContext } from '../test_utils/chatProxyTestUtils.js';

const { upstream, makeApp, withServer } = createChatProxyTestContext();

const mockUser = {
  id: 'checkpoint-integration-user',
  email: 'checkpoint-integration@example.com',
  displayName: 'Checkpoint Integration',
};

function fetchLatestConversation(userId) {
  const db = getDb();
  return db
    .prepare('SELECT id FROM conversations WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(userId);
}

function fetchLatestAssistantMessage(conversationId) {
  const db = getDb();
  return db
    .prepare('SELECT status, content FROM messages WHERE conversation_id = ? AND role = ? ORDER BY seq DESC LIMIT 1')
    .get(conversationId, 'assistant');
}

describe('Checkpoint persistence integration', () => {
  beforeEach(() => {
    upstream.setError(false);
  });

  test('normal streaming completion updates row to final', async () => {
    const sessionId = 'checkpoint-session-final';
    const userId = mockUser.id;
    const app = makeApp({ mockUser });
    upsertSession(sessionId, { userId });

    const res = await request(app)
      .post('/v1/chat/completions')
      .set('x-session-id', sessionId)
      .send({ messages: [{ role: 'user', content: 'Hello integration' }], stream: true });

    expect(res.status).toBe(200);

    const conversation = fetchLatestConversation(userId);
    expect(conversation).toBeDefined();

    const message = fetchLatestAssistantMessage(conversation.id);
    expect(message).toBeDefined();
    expect(message.status).toBe('final');
    expect(message.content).toBeTruthy();
  });

  test('client disconnect preserves partial content as error', async () => {
    const sessionId = 'checkpoint-session-disconnect';
    const userId = mockUser.id;
    const app = makeApp({ mockUser });
    upsertSession(sessionId, { userId });
    upstream.setStreamDelayMs(200);

    await withServer(app, async (port) => {
      await new Promise((resolve) => {
        let resolved = false;
        const done = () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };

        const req = http.request(
          {
            method: 'POST',
            hostname: '127.0.0.1',
            port,
            path: '/v1/chat/completions',
            headers: {
              'Content-Type': 'application/json',
              'x-session-id': sessionId,
            },
          },
          (res) => {
            res.once('data', () => {
              req.destroy();
              res.destroy();
              done();
            });
            res.on('error', () => done());
          }
        );

        req.on('error', () => done());
        req.write(JSON.stringify({ messages: [{ role: 'user', content: 'Disconnect test' }], stream: true }));
        req.end();
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    const conversation = fetchLatestConversation(userId);
    expect(conversation).toBeDefined();

    const message = fetchLatestAssistantMessage(conversation.id);
    expect(message).toBeDefined();
    expect(message.status).toBe('error');
    expect(message.content).toBeTruthy();
  });
});