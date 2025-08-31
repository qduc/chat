// Behavior tests for Providers API CRUD and connectivity endpoints
import assert from 'node:assert/strict';
import express from 'express';
import { providersRouter } from '../src/routes/providers.js';
import { config } from '../src/env.js';
import { getDb, resetDbCache } from '../src/db/index.js';

// Helper to spin up a minimal app
const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use(providersRouter);
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
    const app = makeApp();
    await withServer(app, async (port) => {
      const base = `http://127.0.0.1:${port}/v1/providers`;

      // Initially empty list
      let res = await fetch(base);
      assert.equal(res.status, 200);
      let body = await res.json();
      assert.ok(Array.isArray(body.providers));

      // Create provider
      res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'p1',
          name: 'local',
          provider_type: 'openai',
          base_url: 'http://example.com',
          api_key: 'test',
          enabled: true,
        }),
      });
      assert.equal(res.status, 201);
      body = await res.json();
      assert.equal(body.id, 'p1');

      // Get by id
      res = await fetch(`${base}/p1`);
      assert.equal(res.status, 200);
      body = await res.json();
      assert.equal(body.name, 'local');
      assert.equal(body.provider_type, 'openai');

      // Update provider
      res = await fetch(`${base}/p1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      assert.equal(res.status, 200);
      body = await res.json();
      assert.equal(body.enabled, 0); // normalized boolean in DB

      // Set default
      res = await fetch(`${base}/p1/default`, { method: 'POST' });
      assert.equal(res.status, 200);
      body = await res.json();
      assert.equal(body.is_default, 1);

      // List should include the provider
      res = await fetch(base);
      assert.equal(res.status, 200);
      body = await res.json();
      assert.ok(body.providers.some((p) => p.id === 'p1'));

      // Delete
      res = await fetch(`${base}/p1`, { method: 'DELETE' });
      assert.equal(res.status, 204);

      // Get should now 404
      res = await fetch(`${base}/p1`);
      assert.equal(res.status, 404);
    });
  });
});

describe('Providers connectivity', () => {
  test('GET /v1/providers/:id/models returns normalized model list when upstream ok', async () => {
    // Use ESM mocking for node-fetch and import router in isolated module
    const { jest } = await import('@jest/globals');
    await jest.isolateModulesAsync(async () => {
      const fetchMock = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'gpt-x' }, { id: 'gpt-y' }] }),
      });
      const providersModule = await jest.unstable_mockModule('node-fetch', () => ({ default: fetchMock }));
      const { providersRouter: mockedRouter } = await import('../src/routes/providers.js');

      // Seed provider
      const db = getDb();
      db.exec('DELETE FROM providers;');
      db.prepare(`INSERT INTO providers (id, name, provider_type, api_key, base_url, enabled, is_default, extra_headers, metadata, created_at, updated_at)
                  VALUES ('p2','p2','openai','k','http://mock',1,1,'{}','{}',datetime('now'),datetime('now'))`).run();

      const app = express();
      app.use(express.json());
      app.use(mockedRouter);

      await withServer(app, async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/v1/providers/p2/models`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.ok(Array.isArray(body.models));
        assert.ok(body.models.some((m) => m.id === 'gpt-x'));
      });
    });
  });

  test('POST /v1/providers/test maps upstream 401 to friendly message', async () => {
    const { jest } = await import('@jest/globals');
    await jest.isolateModulesAsync(async () => {
      const fetchMock = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });
      await jest.unstable_mockModule('node-fetch', () => ({ default: fetchMock }));
      const { providersRouter: mockedRouter } = await import('../src/routes/providers.js');

      const app = express();
      app.use(express.json());
      app.use(mockedRouter);

      await withServer(app, async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/v1/providers/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'p3', provider_type: 'openai', api_key: 'bad-key', base_url: 'http://mock' }),
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error, 'test_failed');
        assert.ok(/Invalid API key/i.test(body.message));
      });
    });
  });

  test('POST /v1/providers/:id/test uses stored key and succeeds', async () => {
    const { jest } = await import('@jest/globals');
    await jest.isolateModulesAsync(async () => {
      const fetchMock = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'gpt-z' }] }),
      });
      await jest.unstable_mockModule('node-fetch', () => ({ default: fetchMock }));
      const { providersRouter: mockedRouter } = await import('../src/routes/providers.js');

      // Seed provider with key
      const db = getDb();
      db.exec('DELETE FROM providers;');
      db.prepare(`INSERT INTO providers (id, name, provider_type, api_key, base_url, enabled, is_default, extra_headers, metadata, created_at, updated_at)
                  VALUES ('p4','p4','openai','key123','http://mock',1,1,'{}','{}',datetime('now'),datetime('now'))`).run();

      const app = express();
      app.use(express.json());
      app.use(mockedRouter);

      await withServer(app, async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/v1/providers/p4/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base_url: 'http://mock' }),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.success, true);
        assert.ok(typeof body.models === 'number');
      });
    });
  });
});
