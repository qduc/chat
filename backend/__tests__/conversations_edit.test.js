// Behavior tests for message edit + fork conversation flow
import assert from 'node:assert/strict';
import express from 'express';
import { conversationsRouter } from '../src/routes/conversations.js';
import { sessionResolver } from '../src/middleware/session.js';
import { config } from '../src/env.js';
import {
  getDb,
  upsertSession,
  createConversation,
  insertUserMessage,
  insertAssistantFinal,
  resetDbCache,
} from '../src/db/index.js';

const sessionId = 'sess-edit';

const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use(sessionResolver);
  app.use(conversationsRouter);
  return app;
};

const withServer = async (app, fn) => {
  return new Promise((resolve, reject) => {
    const srv = app.listen(0, async () => {
      const port = srv.address().port;
      try {
        const result = await fn(port);
        srv.close(() => resolve(result));
      } catch (err) {
        srv.close(() => reject(err));
      }
    });
  });
};

beforeEach(() => {
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  const db = getDb();
  db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM sessions;');
  upsertSession(sessionId);
});

afterAll(() => {
  resetDbCache();
});

describe('PUT /v1/conversations/:id/messages/:messageId/edit', () => {
  test('edits message, forks new conversation, and prunes original tail', async () => {
    // Seed a conversation with two messages
    const convId = 'conv-edit-1';
    createConversation({ id: convId, sessionId, title: 'T', model: 'm1' });
    const u1 = insertUserMessage({ conversationId: convId, content: 'Hello wrld', seq: 1 });
    insertAssistantFinal({ conversationId: convId, content: 'Hi!', seq: 2, finishReason: 'stop' });

    const app = makeApp();
    await withServer(app, async (port) => {
      // Edit first user message content (fix typo)
      const res = await fetch(
        `http://127.0.0.1:${port}/v1/conversations/${convId}/messages/${u1.id}/edit`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-session-id': sessionId,
          },
          body: JSON.stringify({ content: 'Hello world' }),
        }
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.message.content, 'Hello world');
      assert.ok(body.new_conversation_id);
      const newConvId = body.new_conversation_id;

      // Original conversation should have pruned messages after the edited one
      const resOrig = await fetch(
        `http://127.0.0.1:${port}/v1/conversations/${convId}`,
        { headers: { 'x-session-id': sessionId } }
      );
      const origBody = await resOrig.json();
      const origSeqs = origBody.messages.map((m) => m.seq);
      assert.deepEqual(origSeqs, [1]);

      // New conversation should have copied messages up to the edited one
      const resNew = await fetch(
        `http://127.0.0.1:${port}/v1/conversations/${newConvId}`,
        { headers: { 'x-session-id': sessionId } }
      );
      const newBody = await resNew.json();
      const newSeqs = newBody.messages.map((m) => m.seq);
      assert.deepEqual(newSeqs, [1]);
      assert.equal(newBody.messages[0].content, 'Hello world');
    });
  });
});

