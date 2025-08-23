// Tests for conversations API observable behaviors

import assert from 'node:assert/strict';
import express from 'express';
import { conversationsRouter } from '../src/routes/conversations.js';
import { sessionResolver } from '../src/middleware/session.js';
import { config } from '../src/env.js';
import {
  getDb,
  upsertSession,
  createConversation,
  softDeleteConversation,
} from '../src/db/index.js';

config.persistence.enabled = true;
config.persistence.dbUrl = 'file::memory:';
const db = getDb();
const sessionId = 'sess1';

const makeApp = (useSession = true) => {
  const app = express();
  app.use(express.json());
  if (useSession) app.use(sessionResolver);
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
  db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM sessions;');
  upsertSession(sessionId);
  config.persistence.enabled = true;
  config.persistence.maxConversationsPerSession = 100;
});

// --- POST /v1/conversations ---
describe('POST /v1/conversations', () => {
  test('creates a new conversation and returns 201 with id, title, model, created_at', async () => {
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
        body: JSON.stringify({ title: 't1', model: 'm1' }),
      });
      assert.equal(res.status, 201);
      const body = await res.json();
      assert.ok(body.id);
      assert.equal(body.title, 't1');
      assert.equal(body.model, 'm1');
      assert.ok(body.created_at);
    });
  });

  test('enforces max conversations per session with 429', async () => {
    config.persistence.maxConversationsPerSession = 1;
    const app = makeApp();
    await withServer(app, async (port) => {
      const url = `http://127.0.0.1:${port}/v1/conversations`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      });
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      });
      assert.equal(res.status, 429);
    });
  });

  test('returns 501 when persistence is disabled', async () => {
    config.persistence.enabled = false;
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      });
      assert.equal(res.status, 501);
    });
  });
});

// --- GET /v1/conversations ---
describe('GET /v1/conversations', () => {
  test('lists conversations for current session with pagination (cursor, limit)', async () => {
    createConversation({ id: 'c1', sessionId, title: 'one' });
    await new Promise((r) => setTimeout(r, 10));
    createConversation({ id: 'c2', sessionId, title: 'two' });
    const app = makeApp();
    await withServer(app, async (port) => {
      const first = await fetch(
        `http://127.0.0.1:${port}/v1/conversations?limit=1`,
        { headers: { 'x-session-id': sessionId } }
      );
      const body1 = await first.json();
      assert.equal(body1.items.length, 1);
      assert.equal(body1.items[0].id, 'c2');
      assert.ok(body1.next_cursor);

      const second = await fetch(
        `http://127.0.0.1:${port}/v1/conversations?limit=1&cursor=${encodeURIComponent(
          body1.next_cursor
        )}`,
        { headers: { 'x-session-id': sessionId } }
      );
      const body2 = await second.json();
      assert.equal(body2.items.length, 1);
      assert.equal(body2.items[0].id, 'c1');
      assert.equal(body2.next_cursor, null);
    });
  });

  test('returns 501 when persistence is disabled', async () => {
    config.persistence.enabled = false;
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/conversations`, {
        headers: { 'x-session-id': sessionId },
      });
      assert.equal(res.status, 501);
    });
  });

  test('returns empty items and next_cursor=null when no conversations exist', async () => {
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/conversations`, {
        headers: { 'x-session-id': sessionId },
      });
      const body = await res.json();
      assert.deepEqual(body, { items: [], next_cursor: null });
    });
  });

  test('excludes deleted conversations by default; include_deleted=1 returns them', async () => {
    createConversation({ id: 'c1', sessionId, title: 'one' });
    createConversation({ id: 'c2', sessionId, title: 'two' });
    softDeleteConversation({ id: 'c1', sessionId });
    const app = makeApp();
    await withServer(app, async (port) => {
      const res1 = await fetch(`http://127.0.0.1:${port}/v1/conversations`, {
        headers: { 'x-session-id': sessionId },
      });
      const body1 = await res1.json();
      assert.equal(body1.items.length, 1);
      assert.equal(body1.items[0].id, 'c2');

      const res2 = await fetch(
        `http://127.0.0.1:${port}/v1/conversations?include_deleted=1`,
        { headers: { 'x-session-id': sessionId } }
      );
      const body2 = await res2.json();
      const ids = body2.items.map((i) => i.id).sort();
      assert.deepEqual(ids, ['c1', 'c2']);
    });
  });
});

// --- GET /v1/conversations/:id ---
describe('GET /v1/conversations/:id', () => {
  test('returns 400 when session id is missing (no session resolver)', async () => {
    const app = makeApp(false);
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/conversations/abc`);
      assert.equal(res.status, 400);
    });
  });

  test('returns 404 for non-existent conversation', async () => {
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(
        `http://127.0.0.1:${port}/v1/conversations/missing`,
        { headers: { 'x-session-id': sessionId } }
      );
      assert.equal(res.status, 404);
    });
  });

  test('returns metadata and first page of messages with next_after_seq', async () => {
    createConversation({ id: 'c1', sessionId, title: 'hi' });
    const stmt = db.prepare(
      `INSERT INTO messages (conversation_id, role, content, seq) VALUES (@cid, 'user', @c, @s)`
    );
    stmt.run({ cid: 'c1', c: 'm1', s: 1 });
    stmt.run({ cid: 'c1', c: 'm2', s: 2 });
    stmt.run({ cid: 'c1', c: 'm3', s: 3 });
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/conversations/c1?limit=2`, {
        headers: { 'x-session-id': sessionId },
      });
      const body = await res.json();
      assert.equal(body.id, 'c1');
      assert.equal(body.messages.length, 2);
      assert.equal(body.messages[0].seq, 1);
      assert.equal(body.next_after_seq, 2);
    });
  });

  test('supports after_seq and limit query params', async () => {
    createConversation({ id: 'c1', sessionId, title: 'hi' });
    const stmt = db.prepare(
      `INSERT INTO messages (conversation_id, role, content, seq) VALUES (@cid, 'user', @c, @s)`
    );
    stmt.run({ cid: 'c1', c: 'm1', s: 1 });
    stmt.run({ cid: 'c1', c: 'm2', s: 2 });
    stmt.run({ cid: 'c1', c: 'm3', s: 3 });
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(
        `http://127.0.0.1:${port}/v1/conversations/c1?after_seq=2&limit=2`,
        { headers: { 'x-session-id': sessionId } }
      );
      const body = await res.json();
      assert.equal(body.messages.length, 1);
      assert.equal(body.messages[0].seq, 3);
      assert.equal(body.next_after_seq, null);
    });
  });

  test('returns 501 when persistence is disabled', async () => {
    config.persistence.enabled = false;
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(
        `http://127.0.0.1:${port}/v1/conversations/c1`,
        { headers: { 'x-session-id': sessionId } }
      );
      assert.equal(res.status, 501);
    });
  });
});

// --- DELETE /v1/conversations/:id ---
describe('DELETE /v1/conversations/:id', () => {
  test('soft deletes an existing conversation and returns 204', async () => {
    createConversation({ id: 'c1', sessionId });
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/conversations/c1`, {
        method: 'DELETE',
        headers: { 'x-session-id': sessionId },
      });
      assert.equal(res.status, 204);
      const row = db
        .prepare("SELECT deleted_at FROM conversations WHERE id='c1'")
        .get();
      assert.ok(row.deleted_at);
    });
  });

  test('returns 404 when deleting already deleted conversation', async () => {
    createConversation({ id: 'c1', sessionId });
    softDeleteConversation({ id: 'c1', sessionId });
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/conversations/c1`, {
        method: 'DELETE',
        headers: { 'x-session-id': sessionId },
      });
      assert.equal(res.status, 404);
    });
  });

  test('returns 404 when conversation not found', async () => {
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/conversations/missing`, {
        method: 'DELETE',
        headers: { 'x-session-id': sessionId },
      });
      assert.equal(res.status, 404);
    });
  });

  test('returns 501 when persistence is disabled', async () => {
    config.persistence.enabled = false;
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/conversations/c1`, {
        method: 'DELETE',
        headers: { 'x-session-id': sessionId },
      });
      assert.equal(res.status, 501);
    });
  });
});
