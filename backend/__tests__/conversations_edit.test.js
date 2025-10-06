// Behavior tests for message edit + fork conversation flow
import assert from 'node:assert/strict';
import express from 'express';
import { conversationsRouter } from '../src/routes/conversations.js';
import { sessionResolver } from '../src/middleware/session.js';
import { generateAccessToken } from '../src/middleware/auth.js';
import { config } from '../src/env.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import { createEditIntent } from '../test_utils/intentTestHelpers.js';
import {
  getDb,
  upsertSession,
  createConversation,
  insertUserMessage,
  insertAssistantFinal,
  resetDbCache,
} from '../src/db/index.js';

const sessionId = 'sess-edit';
const userId = 'user-edit-1';
const userEmail = 'edit@example.com';
let authToken;

const makeAuthHeaders = (includeJson = false) => ({
  ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
  'x-session-id': sessionId,
  Authorization: `Bearer ${authToken}`
});

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

beforeAll(() => {
  // Safety check: ensure we're using a test database
  safeTestSetup();
});

beforeEach(() => {
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  const db = getDb();
  db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM sessions; DELETE FROM users;');
  upsertSession(sessionId, { userId });

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at, email_verified, last_login_at, deleted_at)
    VALUES (@id, @email, @password_hash, @display_name, @created_at, @updated_at, @email_verified, @last_login_at, @deleted_at)
  `).run({
    id: userId,
    email: userEmail,
    password_hash: 'hash',
    display_name: 'Edit User',
    created_at: now,
    updated_at: now,
    email_verified: 1,
    last_login_at: now,
    deleted_at: null
  });

  authToken = generateAccessToken({ id: userId, email: userEmail });
});

afterAll(() => {
  resetDbCache();
});

describe('PUT /v1/conversations/:id/messages/:messageId/edit', () => {
  test('edits message, forks new conversation, and prunes original tail', async () => {
    // Seed a conversation with two messages
    const convId = 'conv-edit-1';
    createConversation({ id: convId, sessionId, userId, title: 'T', model: 'm1' });
    const u1 = insertUserMessage({ conversationId: convId, content: 'Hello wrld', seq: 1 });
    insertAssistantFinal({ conversationId: convId, content: 'Hi!', seq: 2, finishReason: 'stop' });

    const app = makeApp();
    await withServer(app, async (port) => {
      // Edit first user message content (fix typo) using intent envelope
      const intentEnvelope = createEditIntent({
        messageId: u1.id,
        expectedSeq: 1,
        content: 'Hello world',
        conversationId: convId
      });

      const res = await fetch(
        `http://127.0.0.1:${port}/v1/conversations/${convId}/messages/${u1.id}/edit`,
        {
          method: 'PUT',
          headers: makeAuthHeaders(true),
          body: JSON.stringify(intentEnvelope),
        }
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      // Phase 4: Intent responses have different structure
      assert.equal(body.success, true);
      assert.ok(body.client_operation);
      assert.ok(body.fork_conversation_id);
      const newConvId = body.fork_conversation_id;

      // Original conversation should have pruned messages after the edited one
      const resOrig = await fetch(
        `http://127.0.0.1:${port}/v1/conversations/${convId}`,
        { headers: makeAuthHeaders() }
      );
      const origBody = await resOrig.json();
      const origSeqs = origBody.messages.map((m) => m.seq);
      assert.equal(origSeqs.length, 1);
      assert.equal(origSeqs[0], 1);

      // New conversation should have copied messages up to the edited one
      const resNew = await fetch(
        `http://127.0.0.1:${port}/v1/conversations/${newConvId}`,
        { headers: makeAuthHeaders() }
      );
      const newBody = await resNew.json();
      const newSeqs = newBody.messages.map((m) => m.seq);
      assert.equal(newSeqs.length, 1);
      assert.equal(newSeqs[0], 1);
      assert.equal(newBody.messages[0].content, 'Hello world');
    });
  });

  test('edits message with images - preserves image content when text is updated', async () => {
    // Seed a conversation with a message containing mixed content (text + image)
    const convId = 'conv-edit-images-1';
    createConversation({ id: convId, sessionId, userId, title: 'Image Edit Test', model: 'm1' });

    const mixedContent = [
      { type: 'text', text: 'Check out this imge:' }, // Typo to fix
      { type: 'image_url', image_url: { url: 'http://localhost:3001/v1/images/test-img-123', detail: 'auto' } }
    ];

    const u1 = insertUserMessage({ conversationId: convId, content: mixedContent, seq: 1 });
    insertAssistantFinal({ conversationId: convId, content: 'Nice image!', seq: 2, finishReason: 'stop' });

    const app = makeApp();
    await withServer(app, async (port) => {
      // Edit message: fix typo but keep the image
      const updatedContent = [
        { type: 'text', text: 'Check out this image:' }, // Fixed typo
        { type: 'image_url', image_url: { url: 'http://localhost:3001/v1/images/test-img-123', detail: 'auto' } }
      ];

      const intentEnvelope = createEditIntent({
        messageId: u1.id,
        expectedSeq: 1,
        content: updatedContent,
        conversationId: convId
      });

      const res = await fetch(
        `http://127.0.0.1:${port}/v1/conversations/${convId}/messages/${u1.id}/edit`,
        {
          method: 'PUT',
          headers: makeAuthHeaders(true),
          body: JSON.stringify(intentEnvelope),
        }
      );

      assert.equal(res.status, 200);
      const body = await res.json();
      // Phase 4: Intent responses have different structure
      assert.equal(body.success, true);
      assert.ok(body.client_operation);
      assert.ok(body.fork_conversation_id);

      const newConvId = body.fork_conversation_id;

      // Verify new conversation has the updated content with preserved image
      const resNew = await fetch(
        `http://127.0.0.1:${port}/v1/conversations/${newConvId}`,
        { headers: makeAuthHeaders() }
      );
      const newBody = await resNew.json();
      assert.equal(newBody.messages.length, 1);

      const editedMessage = newBody.messages[0];
      assert.ok(Array.isArray(editedMessage.content), 'Edited message content should be an array');
      assert.equal(editedMessage.content.length, 2);
      assert.equal(editedMessage.content[0].type, 'text');
      assert.equal(editedMessage.content[0].text, 'Check out this image:');
      assert.equal(editedMessage.content[1].type, 'image_url');
      assert.equal(editedMessage.content[1].image_url.url, 'http://localhost:3001/v1/images/test-img-123');
    });
  });

  test('rejects edit with empty content', async () => {
    const convId = 'conv-edit-empty';
    createConversation({ id: convId, sessionId, userId, title: 'Empty', model: 'm1' });
    const u1 = insertUserMessage({ conversationId: convId, content: 'Original', seq: 1 });

    const app = makeApp();
    await withServer(app, async (port) => {
      const intentEnvelope = createEditIntent({
        messageId: u1.id,
        expectedSeq: 1,
        content: '',
        conversationId: convId
      });

      const res = await fetch(
        `http://127.0.0.1:${port}/v1/conversations/${convId}/messages/${u1.id}/edit`,
        {
          method: 'PUT',
          headers: makeAuthHeaders(true),
          body: JSON.stringify(intentEnvelope),
        }
      );
      assert.equal(res.status, 400);
      const body = await res.json();
      // Phase 4: Now returns validation_error since intent middleware validates first
      assert.equal(body.error, 'validation_error');
    });
  });

  test('rejects edit with invalid content type', async () => {
    const convId = 'conv-edit-invalid';
    createConversation({ id: convId, sessionId, userId, title: 'Invalid', model: 'm1' });
    const u1 = insertUserMessage({ conversationId: convId, content: 'Original', seq: 1 });

    const app = makeApp();
    await withServer(app, async (port) => {
      const intentEnvelope = createEditIntent({
        messageId: u1.id,
        expectedSeq: 1,
        content: 123, // Invalid: number instead of string/array
        conversationId: convId
      });

      const res = await fetch(
        `http://127.0.0.1:${port}/v1/conversations/${convId}/messages/${u1.id}/edit`,
        {
          method: 'PUT',
          headers: makeAuthHeaders(true),
          body: JSON.stringify(intentEnvelope),
        }
      );
      assert.equal(res.status, 400);
      const body = await res.json();
      // Phase 4: Now returns validation_error since intent middleware validates first
      assert.equal(body.error, 'validation_error');
    });
  });
});
