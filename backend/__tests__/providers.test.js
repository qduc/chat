// Behavior tests for Providers API CRUD and connectivity endpoints
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';
import { config } from '../src/env.js';
import { getDb, resetDbCache } from '../src/db/index.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';

// Helper to spin up a minimal app
const makeApp = (router) => {
  const app = express();
  app.use(express.json());
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

beforeAll(() => {
  // Safety check: ensure we're using a test database
  safeTestSetup();
  // Ensure DB enabled for provider storage
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  getDb();
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
    db.prepare(`INSERT INTO providers (id, name, provider_type, api_key, base_url, enabled, is_default, extra_headers, metadata, created_at, updated_at)
                VALUES ('p2','p2','openai','k','http://mock',1,1,'{}','{}',datetime('now'),datetime('now'))`).run();

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
    db.prepare(`INSERT INTO providers (id, name, provider_type, api_key, base_url, enabled, is_default, extra_headers, metadata, created_at, updated_at)
                VALUES ('p4','p4','openai','key123','http://mock',1,1,'{}','{}',datetime('now'),datetime('now'))`).run();

    const res = await agent.post('/v1/providers/p4/test').send({ base_url: 'http://mock' });
    if (res.status !== 200) {
      console.log('Provider :id/test error:', res.status, res.text);
    }
    assert.equal(res.status, 200);
    const body = res.body;
    assert.equal(body.success, true);
    assert.ok(typeof body.models === 'number');
  });
});
