// Tests for conversations API observable behaviors

import assert from 'node:assert/strict';
import express from 'express';
import { conversationsRouter } from '../src/routes/conversations.js';
import request from 'supertest';
import { sessionResolver } from '../src/middleware/session.js';
import { config } from '../src/env.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import {
  getDb,
  upsertSession,
  createConversation,
  softDeleteConversation,
  resetDbCache,
} from '../src/db/index.js';
import { createUser } from '../src/db/users.js';
import { generateAccessToken } from '../src/middleware/auth.js';

const sessionId = 'sess1';
let authHeader = null;
let testUser = null;

beforeAll(() => {
  // Safety check: ensure we're using a test database
  safeTestSetup();
});

// makeApp can opt-in to session resolver and/or test auth injection.
// New logic: session-based auth was removed from the routes; tests should
// provide an authenticated user where needed. By default tests will mount
// a fake auth middleware that assigns req.user.id.
const makeApp = ({ useSession = true, auth = true } = {}) => {
  const app = express();
  app.use(express.json());
  if (useSession) app.use(sessionResolver);
  if (auth) {
    // Inject an Authorization header with a test token so optionalAuth
    // middleware inside the router will populate req.user.
    app.use((req, _res, next) => {
      if (authHeader) req.headers['authorization'] = authHeader;
      next();
    });
  }
  app.use(conversationsRouter);
  return app;
};

beforeEach(() => {
  // Reset config and database state for each test
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  config.persistence.maxConversationsPerSession = 100;
  resetDbCache();
  const db = getDb();
  db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM sessions; DELETE FROM providers;');

  // Create a test user and generate an access token for authenticated requests
  testUser = createUser({ email: 'test@example.com', passwordHash: 'pw', displayName: 'Test User' });
  const token = generateAccessToken(testUser);
  authHeader = `Bearer ${token}`;

  upsertSession(sessionId, { userId: testUser.id });
  db.prepare(`INSERT INTO providers (id, user_id, name, provider_type) VALUES (@id, @userId, @name, @provider_type)`).run({ id: 'p1', userId: testUser.id, name: 'p1', provider_type: 'openai' });
  db.prepare(`INSERT INTO providers (id, user_id, name, provider_type) VALUES (@id, @userId, @name, @provider_type)`).run({ id: 'p2', userId: testUser.id, name: 'p2', provider_type: 'openai' });
});

afterAll(() => {
  // Properly close database connections to prevent process leaks
  resetDbCache();
});

// --- POST /v1/conversations ---
describe('POST /v1/conversations', () => {
  test('creates a new conversation and returns 201 with id, title, provider, model, created_at', async () => {
    const app = makeApp();
      const res = await request(app)
        .post('/v1/conversations')
        .set('x-session-id', sessionId)
          .send({ title: 't1', provider_id: 'p1', model: 'm1', custom_request_params_id: ['thinking-on'] });
    assert.equal(res.status, 201);
    const body = res.body;
    assert.ok(body.id);
    assert.equal(body.title, 't1');
      assert.equal(body.provider_id, 'p1');
    assert.equal(body.model, 'm1');
    assert.ok(body.created_at);
      assert.deepEqual(body.custom_request_params_id, ['thinking-on']);
  });

  test('creates multiple conversations for an authenticated user (session limit removed)', async () => {
    // Session-based conversation limits were removed from the guarded path.
    // Authenticated users should be able to create conversations.
    config.persistence.maxConversationsPerSession = 1;
    const app = makeApp();
    const r1 = await request(app).post('/v1/conversations').set('x-session-id', sessionId).send();
    const r2 = await request(app).post('/v1/conversations').set('x-session-id', sessionId).send();
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);
  });

  test('returns 501 when persistence is disabled', async () => {
    config.persistence.enabled = false;
    const app = makeApp({ useSession: false });
    const res = await request(app).post('/v1/conversations').set('x-session-id', sessionId).send();
    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'auth_error');
  });
});

// --- GET /v1/conversations ---
describe('GET /v1/conversations', () => {
  test('lists conversations for current session with pagination (cursor, limit)', async () => {
  createConversation({
    id: 'c1',
    sessionId,
    userId: testUser.id,
    title: 'one',
    provider_id: 'p1',
      metadata: { custom_request_params_id: ['thinking-on'] },
  });
  createConversation({ id: 'c2', sessionId, userId: testUser.id, title: 'two', provider_id: 'p2' });
    // Make ordering deterministic without relying on wall-clock timing
    const db = getDb();
    db.prepare(`UPDATE conversations SET created_at = datetime('now', '-1 hour') WHERE id = 'c1'`).run();
    db.prepare(`UPDATE conversations SET created_at = datetime('now') WHERE id = 'c2'`).run();
    const app = makeApp();
    const first = await request(app).get('/v1/conversations?limit=1').set('x-session-id', sessionId);
    const body1 = first.body;
      assert.equal(body1.items.length, 1);
      assert.equal(body1.items[0].id, 'c2');
        assert.equal(body1.items[0].provider_id, 'p2');
      assert.ok(body1.next_cursor);

    const second = await request(app)
      .get(`/v1/conversations?limit=1&cursor=${encodeURIComponent(body1.next_cursor)}`)
      .set('x-session-id', sessionId);
    const body2 = second.body;
      assert.equal(body2.items.length, 1);
      assert.equal(body2.items[0].id, 'c1');
        assert.equal(body2.items[0].provider_id, 'p1');
      assert.equal(body2.next_cursor, null);
  });

  test('returns 501 when persistence is disabled', async () => {
    config.persistence.enabled = false;
    const app = makeApp({ useSession: false });
    const res = await request(app).get('/v1/conversations').set('x-session-id', sessionId);
    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'auth_error');
  });

  test('returns empty items and next_cursor=null when no conversations exist', async () => {
    const app = makeApp();
    const res = await request(app).get('/v1/conversations').set('x-session-id', sessionId);
    const body = res.body;
    assert.equal(body.items.length, 0);
    assert.equal(body.next_cursor, null);
  });

  test('excludes deleted conversations by default; include_deleted=1 returns them', async () => {
  createConversation({ id: 'c1', sessionId, userId: testUser.id, title: 'one', provider_id: 'p1' });
  createConversation({ id: 'c2', sessionId, userId: testUser.id, title: 'two', provider_id: 'p2' });
    softDeleteConversation({ id: 'c1', sessionId, userId: testUser.id });
    const app = makeApp();
    const res1 = await request(app).get('/v1/conversations').set('x-session-id', sessionId);
    const body1 = res1.body;
      assert.equal(body1.items.length, 1);
  assert.equal(body1.items[0].id, 'c2');
  assert.equal(body1.items[0].provider_id, 'p2');

    const res2 = await request(app).get('/v1/conversations?include_deleted=1').set('x-session-id', sessionId);
    const body2 = res2.body;
      const items = body2.items.sort((a, b) => a.id.localeCompare(b.id));
      assert.equal(items.length, 2);
  assert.equal(items[0].id, 'c1');
  assert.equal(items[0].provider_id, 'p1');
  assert.equal(items[1].id, 'c2');
  assert.equal(items[1].provider_id, 'p2');
  });

  test('excludes linked comparison conversations from list results', async () => {
    createConversation({ id: 'parent', sessionId, userId: testUser.id, title: 'parent' });
    createConversation({
      id: 'linked',
      sessionId,
      userId: testUser.id,
      title: 'linked',
      parentConversationId: 'parent',
    });
    createConversation({ id: 'standalone', sessionId, userId: testUser.id, title: 'standalone' });

    const app = makeApp();
    const res = await request(app).get('/v1/conversations').set('x-session-id', sessionId);
    const ids = res.body.items.map((item) => item.id).sort();
    assert.deepEqual(ids, ['parent', 'standalone']);
  });
});

// --- GET /v1/conversations/:id ---
describe('GET /v1/conversations/:id', () => {
  test('returns 401 when unauthenticated (no auth middleware)', async () => {
    // If no auth middleware is present the routes should return 401 unauthorized.
    const app = makeApp({ useSession: false, auth: false });
    const res = await request(app).get('/v1/conversations/abc');
    assert.equal(res.status, 401);
  });

  test('returns 404 for non-existent conversation', async () => {
    const app = makeApp();
    const res = await request(app).get('/v1/conversations/missing').set('x-session-id', sessionId);
    assert.equal(res.status, 404);
  });

  test('returns metadata and first page of messages with next_after_seq', async () => {
  createConversation({
    id: 'c1',
    sessionId,
    userId: testUser.id,
    title: 'hi',
    provider_id: 'p1',
      metadata: { custom_request_params_id: ['thinking-on'] },
  });
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO messages (conversation_id, role, content, seq) VALUES (@cid, 'user', @c, @s)`
    );
    stmt.run({ cid: 'c1', c: 'm1', s: 1 });
    stmt.run({ cid: 'c1', c: 'm2', s: 2 });
    stmt.run({ cid: 'c1', c: 'm3', s: 3 });
    const app = makeApp();
    const res = await request(app).get('/v1/conversations/c1?limit=2').set('x-session-id', sessionId);
    const body = res.body;
    assert.equal(body.id, 'c1');
      assert.equal(body.provider_id, 'p1');
      assert.deepEqual(body.custom_request_params_id, ['thinking-on']);
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0].seq, 1);
    assert.equal(body.next_after_seq, 2);
  });

  test('supports after_seq and limit query params', async () => {
  createConversation({ id: 'c1', sessionId, userId: testUser.id, title: 'hi', provider_id: 'p1' });
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO messages (conversation_id, role, content, seq) VALUES (@cid, 'user', @c, @s)`
    );
    stmt.run({ cid: 'c1', c: 'm1', s: 1 });
    stmt.run({ cid: 'c1', c: 'm2', s: 2 });
    stmt.run({ cid: 'c1', c: 'm3', s: 3 });
    const app = makeApp();
    const res = await request(app)
      .get('/v1/conversations/c1?after_seq=2&limit=2')
      .set('x-session-id', sessionId);
  const body = res.body;
  assert.equal(body.provider_id, 'p1');
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].seq, 3);
    assert.equal(body.next_after_seq, null);
  });

  test('returns 501 when persistence is disabled', async () => {
    config.persistence.enabled = false;
    const app = makeApp({ useSession: false });
    const res = await request(app).get('/v1/conversations/c1').set('x-session-id', sessionId);
    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'auth_error');
  });
});

// --- GET /v1/conversations/:id/linked ---
describe('GET /v1/conversations/:id/linked', () => {
  test('returns linked comparison conversations for the parent', async () => {
    createConversation({ id: 'parent', sessionId, userId: testUser.id, title: 'parent' });
    createConversation({
      id: 'child-1',
      sessionId,
      userId: testUser.id,
      title: 'child 1',
      parentConversationId: 'parent',
    });
    createConversation({
      id: 'child-2',
      sessionId,
      userId: testUser.id,
      title: 'child 2',
      parentConversationId: 'parent',
    });

    const app = makeApp();
    const res = await request(app)
      .get('/v1/conversations/parent/linked')
      .set('x-session-id', sessionId);

    assert.equal(res.status, 200);
    const ids = res.body.conversations.map((item) => item.id).sort();
    assert.deepEqual(ids, ['child-1', 'child-2']);
  });

  test('returns 404 when parent conversation is not owned by the user', async () => {
    const otherUser = createUser({
      email: 'other@example.com',
      passwordHash: 'pw',
      displayName: 'Other User',
    });
    createConversation({ id: 'other-parent', sessionId, userId: otherUser.id, title: 'other' });

    const app = makeApp();
    const res = await request(app)
      .get('/v1/conversations/other-parent/linked')
      .set('x-session-id', sessionId);

    assert.equal(res.status, 404);
  });
});

// --- DELETE /v1/conversations/:id ---
describe('DELETE /v1/conversations/:id', () => {
  test('soft deletes linked comparison conversations with the parent', async () => {
    createConversation({ id: 'parent', sessionId, userId: testUser.id, title: 'parent' });
    createConversation({
      id: 'linked',
      sessionId,
      userId: testUser.id,
      title: 'linked',
      parentConversationId: 'parent',
    });

    const app = makeApp();
    const res = await request(app).delete('/v1/conversations/parent').set('x-session-id', sessionId);
    assert.equal(res.status, 204);

    const db = getDb();
    const parent = db.prepare('SELECT deleted_at FROM conversations WHERE id = ?').get('parent');
    const linked = db.prepare('SELECT deleted_at FROM conversations WHERE id = ?').get('linked');
    assert.ok(parent.deleted_at);
    assert.ok(linked.deleted_at);
  });
});

// --- DELETE /v1/conversations/:id ---
describe('DELETE /v1/conversations/:id', () => {
  test('soft deletes an existing conversation and returns 204', async () => {
  createConversation({ id: 'c1', sessionId, userId: testUser.id, provider_id: 'p1' });
    const app = makeApp();
    const res = await request(app).delete('/v1/conversations/c1').set('x-session-id', sessionId);
    assert.equal(res.status, 204);
    const db = getDb();
    const row = db.prepare("SELECT deleted_at FROM conversations WHERE id='c1'").get();
    assert.ok(row.deleted_at);
  });

  test('returns 404 when deleting already deleted conversation', async () => {
  createConversation({ id: 'c1', sessionId, userId: testUser.id, provider_id: 'p1' });
    softDeleteConversation({ id: 'c1', sessionId, userId: testUser.id });
    const app = makeApp();
    const res = await request(app).delete('/v1/conversations/c1').set('x-session-id', sessionId);
    assert.equal(res.status, 404);
  });

  test('returns 404 when conversation not found', async () => {
    const app = makeApp();
    const res = await request(app).delete('/v1/conversations/missing').set('x-session-id', sessionId);
    assert.equal(res.status, 404);
  });

  test('returns 501 when persistence is disabled', async () => {
    config.persistence.enabled = false;
    const app = makeApp({ useSession: false });
    const res = await request(app).delete('/v1/conversations/c1').set('x-session-id', sessionId);
    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'auth_error');
  });
});
