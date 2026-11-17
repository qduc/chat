import { describe, expect, test, beforeEach, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { journalRouter } from '../src/routes/journal.js';
import { config } from '../src/env.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import { getDb, resetDbCache } from '../src/db/index.js';
import { createUser } from '../src/db/users.js';
import { insertJournalEntry } from '../src/db/journal.js';
import { generateAccessToken } from '../src/middleware/auth.js';

let authHeader = null;
let alice = null;
let bob = null;

beforeAll(() => {
  safeTestSetup();
});

const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (authHeader) req.headers['authorization'] = authHeader;
    next();
  });
  app.use(journalRouter);
  return app;
};

const as = (user) => {
  authHeader = `Bearer ${generateAccessToken(user)}`;
};

beforeEach(() => {
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  const db = getDb();
  db.exec('DELETE FROM journal; DELETE FROM users;');
  alice = createUser({ email: 'alice-journal@example.com', passwordHash: 'pw', displayName: 'Alice' });
  bob = createUser({ email: 'bob-journal@example.com', passwordHash: 'pw', displayName: 'Bob' });
  as(alice);
});

afterAll(() => {
  resetDbCache();
});

describe('GET /v1/journal', () => {
  test('requires authentication', async () => {
    authHeader = null;
    const res = await request(makeApp()).get('/v1/journal');
    expect(res.status).toBe(401);
  });

  test('lists only the caller\'s entries, newest first, with the documented shape', async () => {
    insertJournalEntry({ userId: alice.id, modelName: 'gpt-4.1', content: 'first' });
    insertJournalEntry({ userId: bob.id, modelName: 'gpt-4.1', content: 'bob secret' });
    insertJournalEntry({ userId: alice.id, modelName: 'claude', content: 'second' });

    const res = await request(makeApp()).get('/v1/journal');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      entries: [
        { id: expect.any(Number), model_name: 'claude', content: 'second', created_at: expect.any(String) },
        { id: expect.any(Number), model_name: 'gpt-4.1', content: 'first', created_at: expect.any(String) },
      ],
      page: 1,
      page_size: 20,
      has_more: false,
    });
    expect(Object.keys(res.body.entries[0]).sort()).toEqual(['content', 'created_at', 'id', 'model_name']);
  });

  test('paginates with has_more', async () => {
    for (let i = 1; i <= 5; i++) insertJournalEntry({ userId: alice.id, modelName: 'm', content: `entry ${i}` });

    const first = await request(makeApp()).get('/v1/journal').query({ page: 1, page_size: 2 });
    expect(first.body.entries.map((e) => e.content)).toEqual(['entry 5', 'entry 4']);
    expect(first.body).toMatchObject({ page: 1, page_size: 2, has_more: true });

    const last = await request(makeApp()).get('/v1/journal').query({ page: 3, page_size: 2 });
    expect(last.body.entries.map((e) => e.content)).toEqual(['entry 1']);
    expect(last.body.has_more).toBe(false);
  });

  test('caps page_size at 100', async () => {
    const res = await request(makeApp()).get('/v1/journal').query({ page_size: 500 });
    expect(res.status).toBe(200);
    expect(res.body.page_size).toBe(100);
  });

  test('rejects invalid paging with a structured 400', async () => {
    for (const query of [{ page: 0 }, { page: 'abc' }, { page_size: -1 }]) {
      const res = await request(makeApp()).get('/v1/journal').query(query);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invalid_request', message: expect.any(String) });
    }
  });
});

describe('DELETE /v1/journal/:id', () => {
  test('deletes the caller\'s own entry', async () => {
    const entry = insertJournalEntry({ userId: alice.id, modelName: 'm', content: 'forget me' });
    const res = await request(makeApp()).delete(`/v1/journal/${entry.id}`);
    expect(res.status).toBe(204);

    const list = await request(makeApp()).get('/v1/journal');
    expect(list.body.entries).toEqual([]);
  });

  test('cannot delete another user\'s entry (404, entry survives)', async () => {
    const bobs = insertJournalEntry({ userId: bob.id, modelName: 'm', content: 'bob only' });

    const res = await request(makeApp()).delete(`/v1/journal/${bobs.id}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');

    as(bob);
    const list = await request(makeApp()).get('/v1/journal');
    expect(list.body.entries.map((e) => e.content)).toEqual(['bob only']);
  });

  test('404 for missing or malformed ids', async () => {
    expect((await request(makeApp()).delete('/v1/journal/999999')).status).toBe(404);
    expect((await request(makeApp()).delete('/v1/journal/abc')).status).toBe(404);
  });
});
