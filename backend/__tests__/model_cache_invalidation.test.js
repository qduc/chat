
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';
import { randomUUID } from 'crypto';
import { config } from '../src/env.js';
import { getDb, resetDbCache } from '../src/db/index.js';
import { generateAccessToken } from '../src/middleware/auth.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import { setCachedModels, getCachedModels } from '../src/lib/modelCache.js';

const insertTestUser = (db) => {
  const id = randomUUID();
  const now = new Date().toISOString();
  const email = `cache-test-${now}@example.com`;

  db.prepare(
    `
    INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at, email_verified, last_login_at, deleted_at)
    VALUES (@id, @email, 'test-hash', 'Cache Tester', @now, @now, 1, NULL, NULL)
  `
  ).run({ id, email, now });

  return { id, email, displayName: 'Cache Tester' };
};

const makeApp = (router, getAuthHeader) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.headers['authorization'] = getAuthHeader();
    next();
  });
  app.use(router);
  return app;
};

describe('Model Cache Invalidation Integration', () => {
  let testUser;
  let app;
  let db;

  beforeAll(async () => {
    safeTestSetup();
    config.persistence.enabled = true;
    config.persistence.dbUrl = 'file::memory:';

    const { createProvidersRouter } = await import('../src/routes/providers.js');
    const providersRouter = createProvidersRouter({ http: jest.fn() });

    app = makeApp(providersRouter, () => `Bearer ${generateAccessToken(testUser)}`);
  });

  beforeEach(() => {
    resetDbCache();
    db = getDb();
    db.exec('DELETE FROM providers; DELETE FROM users;');
    testUser = insertTestUser(db);
  });

  afterAll(() => {
    resetDbCache();
  });

  test('creating a provider invalidates model cache', async () => {
    const userId = testUser.id;
    // 1. Set some dummy cache
    setCachedModels(userId, [{ provider: { id: 'old' }, models: [] }]);
    assert.ok(getCachedModels(userId));

    // 2. Create provider
    const res = await request(app)
      .post('/v1/providers')
      .send({
        name: 'new provider',
        provider_type: 'openai',
        enabled: true
      });

    if (res.status !== 201) {
       console.error('Create provider failed:', res.status, res.body);
    }
    assert.equal(res.status, 201);

    // 3. Verify cache is cleared
    assert.equal(getCachedModels(userId), null, 'Cache should be cleared after provider creation');
  });

  test('updating a provider invalidates model cache', async () => {
    const userId = testUser.id;

    // Create a provider first
    const setupRes = await request(app)
      .post('/v1/providers')
      .send({
        id: 'p-update',
        name: 'update target',
        provider_type: 'openai',
        enabled: true
      });
    const providerId = setupRes.body.id;

    // 1. Set some dummy cache
    setCachedModels(userId, [{ provider: { id: 'old' }, models: [] }]);
    assert.ok(getCachedModels(userId));

    // 2. Update provider
    const res = await request(app)
      .put(`/v1/providers/${providerId}`)
      .send({
        name: 'updated name'
      });

    assert.equal(res.status, 200);

    // 3. Verify cache is cleared
    assert.equal(getCachedModels(userId), null, 'Cache should be cleared after provider update');
  });

  test('deleting a provider invalidates model cache', async () => {
    const userId = testUser.id;

    // Create a provider first
    const setupRes = await request(app)
      .post('/v1/providers')
      .send({
        id: 'p-delete',
        name: 'delete target',
        provider_type: 'openai',
        enabled: true
      });
    const providerId = setupRes.body.id;

    // 1. Set some dummy cache
    setCachedModels(userId, [{ provider: { id: 'old' }, models: [] }]);
    assert.ok(getCachedModels(userId));

    // 2. Delete provider
    const res = await request(app).delete(`/v1/providers/${providerId}`);

    assert.equal(res.status, 204);

    // 3. Verify cache is cleared
    assert.equal(getCachedModels(userId), null, 'Cache should be cleared after provider deletion');
  });

  test('setting default provider invalidates model cache', async () => {
    const userId = testUser.id;

    // Create a provider first
    const setupRes = await request(app)
      .post('/v1/providers')
      .send({
        id: 'p-default',
        name: 'default target',
        provider_type: 'openai',
        enabled: true
      });
    const providerId = setupRes.body.id;

    // 1. Set some dummy cache
    setCachedModels(userId, [{ provider: { id: 'old' }, models: [] }]);
    assert.ok(getCachedModels(userId));

    // 2. Set default
    const res = await request(app).post(`/v1/providers/${providerId}/default`);

    assert.equal(res.status, 200);

    // 3. Verify cache is cleared
    assert.equal(getCachedModels(userId), null, 'Cache should be cleared after setting default provider');
  });
});
