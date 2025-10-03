// Test that model_filter metadata is applied when fetching provider models
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';
import { config } from '../src/env.js';
import { getDb, resetDbCache } from '../src/db/index.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';

const makeApp = (router) => {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
};

beforeAll(() => {
  safeTestSetup();
});

beforeEach(() => {
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  const db = getDb();
  db.exec('DELETE FROM providers;');
});

afterAll(() => {
  resetDbCache();
});

describe('Provider model filtering', () => {
  test('GET /v1/providers/:id/models applies model_filter from metadata', async () => {
    const mockHttp = jest.fn(async (url, _options) => {
      if (url.includes('/v1/models')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'gpt-4' },
              { id: 'gpt-4-turbo' },
              { id: 'gpt-4o' },
              { id: 'gpt-3.5-turbo' },
              { id: 'claude-3-opus' },
              { id: 'claude-3-5-sonnet-20241022' },
              { id: 'gemini-1.5-pro' },
            ]
          })
        };
      }
      return { ok: false };
    });

    const { createProvidersRouter } = await import('../src/routes/providers.js');
    const app = makeApp(createProvidersRouter({ http: mockHttp }));
    const agent = request(app);

    const db = getDb();
    db.exec('DELETE FROM providers;');

    // Create provider with model filter
    db.prepare(`INSERT INTO providers (id, name, provider_type, api_key, base_url, enabled, is_default, extra_headers, metadata, created_at, updated_at)
                VALUES ('test-provider','Test','openai','key123','https://api.test.com',1,1,'{}',@metadata,datetime('now'),datetime('now'))`
    ).run({
      metadata: JSON.stringify({ model_filter: 'gpt-4*; *sonnet*' })
    });

    const res = await agent.get('/v1/providers/test-provider/models');
    assert.equal(res.status, 200);
    const body = res.body;
    assert.ok(Array.isArray(body.models));

    // Should only include models matching "gpt-4*" or "*sonnet*"
    // Expected: gpt-4, gpt-4-turbo, gpt-4o, claude-3-5-sonnet-20241022
    assert.equal(body.models.length, 4);
    assert.ok(body.models.some((m) => m.id === 'gpt-4'));
    assert.ok(body.models.some((m) => m.id === 'gpt-4-turbo'));
    assert.ok(body.models.some((m) => m.id === 'gpt-4o'));
    assert.ok(body.models.some((m) => m.id === 'claude-3-5-sonnet-20241022'));

    // Should NOT include these
    assert.ok(!body.models.some((m) => m.id === 'gpt-3.5-turbo'));
    assert.ok(!body.models.some((m) => m.id === 'claude-3-opus'));
    assert.ok(!body.models.some((m) => m.id === 'gemini-1.5-pro'));
  });

  test('GET /v1/providers/:id/models returns all models when no filter is set', async () => {
    const mockHttp = jest.fn(async (url, _options) => {
      if (url.includes('/v1/models')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'gpt-4' },
              { id: 'gpt-4o' },
              { id: 'claude-3-opus' },
            ]
          })
        };
      }
      return { ok: false };
    });

    const { createProvidersRouter } = await import('../src/routes/providers.js');
    const app = makeApp(createProvidersRouter({ http: mockHttp }));
    const agent = request(app);

    const db = getDb();
    db.exec('DELETE FROM providers;');

    // Create provider without model filter
    db.prepare(`INSERT INTO providers (id, name, provider_type, api_key, base_url, enabled, is_default, extra_headers, metadata, created_at, updated_at)
                VALUES ('test-provider','Test','openai','key123','https://api.test.com',1,1,'{}','{}',datetime('now'),datetime('now'))`
    ).run();

    const res = await agent.get('/v1/providers/test-provider/models');
    assert.equal(res.status, 200);
    const body = res.body;
    assert.ok(Array.isArray(body.models));

    // Should include all models
    assert.equal(body.models.length, 3);
  });

  test('POST /v1/providers/test applies model_filter from metadata', async () => {
    const mockHttp = jest.fn(async (url, _options) => {
      if (url.includes('/v1/models')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'gpt-4' },
              { id: 'gpt-4o' },
              { id: 'gpt-3.5-turbo' },
              { id: 'claude-3-opus' },
            ]
          })
        };
      }
      return { ok: false };
    });

    const { createProvidersRouter } = await import('../src/routes/providers.js');
    const app = makeApp(createProvidersRouter({ http: mockHttp }));
    const agent = request(app);

    const res = await agent.post('/v1/providers/test').send({
      name: 'Test Provider',
      provider_type: 'openai',
      base_url: 'https://api.test.com',
      api_key: 'test-key',
      metadata: { model_filter: 'gpt-4*' }
    });

    assert.equal(res.status, 200);
    const body = res.body;
    assert.equal(body.success, true);
    assert.equal(body.models, 2); // Only gpt-4 and gpt-4o should match
  });

  test('POST /v1/providers/:id/test applies model_filter from metadata', async () => {
    const mockHttp = jest.fn(async (url, _options) => {
      if (url.includes('/v1/models')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'gpt-4' },
              { id: 'gpt-4o' },
              { id: 'claude-3-opus' },
              { id: 'claude-3-5-sonnet-20241022' },
            ]
          })
        };
      }
      return { ok: false };
    });

    const { createProvidersRouter } = await import('../src/routes/providers.js');
    const app = makeApp(createProvidersRouter({ http: mockHttp }));
    const agent = request(app);

    const db = getDb();
    db.exec('DELETE FROM providers;');

    // Create provider
    db.prepare(`INSERT INTO providers (id, name, provider_type, api_key, base_url, enabled, is_default, extra_headers, metadata, created_at, updated_at)
                VALUES ('test-provider','Test','openai','key123','https://api.test.com',1,1,'{}','{}',datetime('now'),datetime('now'))`
    ).run();

    const res = await agent.post('/v1/providers/test-provider/test').send({
      metadata: { model_filter: '*sonnet*' }
    });

    assert.equal(res.status, 200);
    const body = res.body;
    assert.equal(body.success, true);
    assert.equal(body.models, 1); // Only claude-3-5-sonnet-20241022 should match
  });
});
