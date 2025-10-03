// Behavior tests for Providers API CRUD and connectivity endpoints
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';
import { randomUUID } from 'crypto';
import { config } from '../src/env.js';
import { getDb, resetDbCache } from '../src/db/index.js';
import { generateAccessToken } from '../src/middleware/auth.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';

const insertTestUser = () => {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const email = `provider-test-${now}@example.com`;

  db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at, email_verified, last_login_at, deleted_at)
    VALUES (@id, @email, 'test-hash', 'Provider Tester', @now, @now, 1, NULL, NULL)
  `).run({ id, email, now });

  return { id, email, displayName: 'Provider Tester' };
};

// Helper to spin up a minimal app
const makeApp = (router) => {
  const app = express();
  app.use(express.json());
  if (authHeader) {
    app.use((req, _res, next) => {
      req.headers['authorization'] = authHeader;
      next();
    });
  }
  app.use(router);
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

let authHeader;
let testUser;

beforeAll(() => {
  // Safety check: ensure we're using a test database
  safeTestSetup();
});

beforeEach(() => {
  // Ensure DB enabled for provider storage
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  const db = getDb();
  db.exec('DELETE FROM providers; DELETE FROM users;');
  testUser = insertTestUser();
  authHeader = `Bearer ${generateAccessToken(testUser)}`;
});

afterAll(() => {
  resetDbCache();
});

describe('Providers CRUD', () => {
  test('create, list, get, update, set default, and delete provider', async () => {
    const { providersRouter } = await import('../src/routes/providers.js');
    const app = makeApp(providersRouter);
    const agent = request(app);

    // Initially empty list
    let res = await agent.get('/v1/providers');
    assert.equal(res.status, 200);
    let body = res.body;
    assert.ok(Array.isArray(body.providers));

    // Create provider
    res = await agent
      .post('/v1/providers')
      .send({
        id: 'p1',
        name: 'local',
        provider_type: 'openai',
        base_url: 'http://example.com',
        api_key: 'test',
        enabled: true,
      });
    assert.equal(res.status, 201);
    body = res.body;
    assert.equal(body.id, 'p1');

    // Get by id
    res = await agent.get('/v1/providers/p1');
    assert.equal(res.status, 200);
    body = res.body;
    assert.equal(body.name, 'local');
    assert.equal(body.provider_type, 'openai');

    // Update provider
    res = await agent.put('/v1/providers/p1').send({ enabled: false });
    assert.equal(res.status, 200);
    body = res.body;
    assert.equal(body.enabled, 0); // normalized boolean in DB

    // Set default
    res = await agent.post('/v1/providers/p1/default');
    assert.equal(res.status, 200);
    body = res.body;
    assert.equal(body.is_default, 1);

    // List should include the provider
    res = await agent.get('/v1/providers');
    assert.equal(res.status, 200);
    body = res.body;
    assert.ok(body.providers.some((p) => p.id === 'p1'));

    // Delete
    res = await agent.delete('/v1/providers/p1');
    assert.equal(res.status, 204);

    // Get should now 404
    res = await agent.get('/v1/providers/p1');
    assert.equal(res.status, 404);
  });
});

describe('Providers connectivity', () => {
  test('GET /v1/providers/:id/models returns normalized model list when upstream ok', async () => {
    // Use DI to inject a mocked HTTP client
    const mockHttp = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-x' }, { id: 'gpt-y' }] }),
    });

    const { createProvidersRouter } = await import('../src/routes/providers.js');
    const app = makeApp(createProvidersRouter({ http: mockHttp }));
    const agent = request(app);

    // Seed provider
    const db = getDb();
    db.exec('DELETE FROM providers;');
    db.prepare(`INSERT INTO providers (id, user_id, name, provider_type, api_key, base_url, enabled, is_default, extra_headers, metadata, created_at, updated_at)
                VALUES ('p2', @user_id, 'p2','openai','k','http://mock',1,1,'{}','{}',datetime('now'),datetime('now'))`).run({ user_id: testUser.id });

    const res = await agent.get('/v1/providers/p2/models');
    assert.equal(res.status, 200);
    const body = res.body;
    assert.ok(Array.isArray(body.models));
    assert.ok(body.models.some((m) => m.id === 'gpt-x'));
  });

  test('POST /v1/providers/test maps upstream 401 to friendly message', async () => {
    // Mock HTTP to simulate 401 unauthorized
    const mockHttp = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const { createProvidersRouter } = await import('../src/routes/providers.js');
    const app = makeApp(createProvidersRouter({ http: mockHttp }));
    const res = await request(app)
      .post('/v1/providers/test')
      .send({ name: 'p3', provider_type: 'openai', api_key: 'bad-key', base_url: 'http://mock' });
    assert.equal(res.status, 400);
    const body = res.body;
    assert.equal(body.error, 'test_failed');
    console.log('Provider test error message:', body.message);
    assert.ok(/Invalid API key/i.test(body.message));
  });

  test('POST /v1/providers/:id/test uses stored key and succeeds', async () => {
    // Mock HTTP to simulate successful response
    const mockHttp = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-z' }] }),
    });

    const { createProvidersRouter } = await import('../src/routes/providers.js');
    const app = makeApp(createProvidersRouter({ http: mockHttp }));
    const agent = request(app);

    // Seed provider with key
    const db = getDb();
    db.exec('DELETE FROM providers;');
    db.prepare(`INSERT INTO providers (id, user_id, name, provider_type, api_key, base_url, enabled, is_default, extra_headers, metadata, created_at, updated_at)
                VALUES ('p4', @user_id, 'p4','openai','key123','http://mock',1,1,'{}','{}',datetime('now'),datetime('now'))`).run({ user_id: testUser.id });

    const res = await agent.post('/v1/providers/p4/test').send({ base_url: 'http://mock' });
    if (res.status !== 200) {
      console.log('Provider :id/test error:', res.status, res.text);
    }
    assert.equal(res.status, 200);
    const body = res.body;
    assert.equal(body.success, true);
    assert.ok(typeof body.models === 'number');
  });

  test('GET /v1/providers/:id/models handles upstream 401 gracefully', async () => {
    // Mock HTTP to simulate 401 unauthorized
    const mockHttp = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const { createProvidersRouter } = await import('../src/routes/providers.js');
    const app = makeApp(createProvidersRouter({ http: mockHttp }));
    const agent = request(app);

    // Seed provider
    const db = getDb();
    db.exec('DELETE FROM providers;');
    db.prepare(`INSERT INTO providers (id, user_id, name, provider_type, api_key, base_url, enabled, is_default, extra_headers, metadata, created_at, updated_at)
                VALUES ('p5', @user_id, 'p5','openai','bad-key','http://mock',1,1,'{}','{}',datetime('now'),datetime('now'))`).run({ user_id: testUser.id });

    const res = await agent.get('/v1/providers/p5/models');
    assert.equal(res.status, 502);
    const body = res.body;
    assert.equal(body.error, 'bad_gateway');
    assert.ok(/Invalid API key/i.test(body.message));
  });

  test('GET /v1/providers/:id/models handles connection timeout gracefully', async () => {
    // Mock HTTP to simulate timeout error
    const timeoutError = new Error('Timeout');
    timeoutError.code = 'ETIMEDOUT';
    const mockHttp = jest.fn().mockRejectedValueOnce(timeoutError);

    const { createProvidersRouter } = await import('../src/routes/providers.js');
    const app = makeApp(createProvidersRouter({ http: mockHttp }));
    const agent = request(app);

    // Seed provider
    const db = getDb();
    db.exec('DELETE FROM providers;');
    db.prepare(`INSERT INTO providers (id, user_id, name, provider_type, api_key, base_url, enabled, is_default, extra_headers, metadata, created_at, updated_at)
                VALUES ('p6', @user_id, 'p6','openai','key','http://unreachable',1,1,'{}','{}',datetime('now'),datetime('now'))`).run({ user_id: testUser.id });

    const res = await agent.get('/v1/providers/p6/models');
    assert.equal(res.status, 502);
    const body = res.body;
    assert.equal(body.error, 'provider_error');
    assert.ok(/Connection timeout/i.test(body.message));
  });

  test('GET /v1/providers/:id/models filters OpenRouter models by creation date', async () => {
    // Create mock models with different creation dates
    const now = Math.floor(Date.now() / 1000);
    const oneYearAgo = now - (365 * 24 * 60 * 60);
    const twoYearsAgo = now - (2 * 365 * 24 * 60 * 60);

    const mockHttp = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'model-recent', created: now - (30 * 24 * 60 * 60) }, // 30 days old
          { id: 'model-old', created: twoYearsAgo }, // 2 years old (should be filtered)
          { id: 'model-edge', created: oneYearAgo + 100 }, // Just under 1 year (should be included)
          { id: 'model-no-date' }, // No created field (should be included)
        ]
      }),
    });

    const { createProvidersRouter } = await import('../src/routes/providers.js');
    const app = makeApp(createProvidersRouter({ http: mockHttp }));
    const agent = request(app);

    // Seed OpenRouter provider
    const db = getDb();
    db.exec('DELETE FROM providers;');
    db.prepare(`INSERT INTO providers (id, user_id, name, provider_type, api_key, base_url, enabled, is_default, extra_headers, metadata, created_at, updated_at)
                VALUES ('openrouter', @user_id, 'OpenRouter','openai','key123','https://openrouter.ai/api',1,1,'{}','{}',datetime('now'),datetime('now'))`).run({ user_id: testUser.id });

    const res = await agent.get('/v1/providers/openrouter/models');
    assert.equal(res.status, 200);
    const body = res.body;
    assert.ok(Array.isArray(body.models));

    // Should only include recent, edge case, and no-date models
    assert.equal(body.models.length, 3);
    assert.ok(body.models.some((m) => m.id === 'model-recent'));
    assert.ok(body.models.some((m) => m.id === 'model-edge'));
    assert.ok(body.models.some((m) => m.id === 'model-no-date'));
    assert.ok(!body.models.some((m) => m.id === 'model-old'));
  });

  test('GET /v1/providers/:id/models does not filter non-OpenRouter providers', async () => {
    const now = Math.floor(Date.now() / 1000);
    const twoYearsAgo = now - (2 * 365 * 24 * 60 * 60);

    const mockHttp = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'model-recent', created: now },
          { id: 'model-old', created: twoYearsAgo }, // Should NOT be filtered for non-OpenRouter
        ]
      }),
    });

    const { createProvidersRouter } = await import('../src/routes/providers.js');
    const app = makeApp(createProvidersRouter({ http: mockHttp }));
    const agent = request(app);

    // Seed regular OpenAI provider
    const db = getDb();
    db.exec('DELETE FROM providers;');
    db.prepare(`INSERT INTO providers (id, user_id, name, provider_type, api_key, base_url, enabled, is_default, extra_headers, metadata, created_at, updated_at)
                VALUES ('openai', @user_id, 'OpenAI','openai','key123','https://api.openai.com',1,1,'{}','{}',datetime('now'),datetime('now'))`).run({ user_id: testUser.id });

    const res = await agent.get('/v1/providers/openai/models');
    assert.equal(res.status, 200);
    const body = res.body;
    assert.ok(Array.isArray(body.models));

    // Should include all models regardless of age
    assert.equal(body.models.length, 2);
    assert.ok(body.models.some((m) => m.id === 'model-recent'));
    assert.ok(body.models.some((m) => m.id === 'model-old'));
  });
});
