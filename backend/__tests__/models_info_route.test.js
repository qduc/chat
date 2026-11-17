import { describe, expect, test, beforeEach, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { modelInfoRouter } from '../src/routes/modelInfo.js';
import { config } from '../src/env.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import { getDb, resetDbCache } from '../src/db/index.js';
import { createUser } from '../src/db/users.js';
import { createProvider } from '../src/db/providers.js';
import { generateAccessToken } from '../src/middleware/auth.js';

let authHeader = null;
let user = null;
let otherUser = null;

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
  app.use(modelInfoRouter);
  return app;
};

beforeEach(() => {
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  const db = getDb();
  db.exec('DELETE FROM providers; DELETE FROM users;');
  user = createUser({ email: 'models-info@example.com', passwordHash: 'pw', displayName: 'Info' });
  otherUser = createUser({ email: 'models-info-2@example.com', passwordHash: 'pw', displayName: 'Other' });
  authHeader = `Bearer ${generateAccessToken(user)}`;
});

afterAll(() => {
  resetDbCache();
});

describe('GET /v1/models/info', () => {
  test('requires authentication', async () => {
    authHeader = null;
    const res = await request(makeApp()).get('/v1/models/info?model=gpt-4.1');
    expect(res.status).toBe(401);
  });

  test('returns catalog metadata and pricing', async () => {
    const res = await request(makeApp()).get('/v1/models/info').query({ model: 'claude-sonnet-4-5-20250929' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      model: 'claude-sonnet-4-5-20250929',
      context_window: 200000,
      max_output_tokens: 64000,
      pricing: { input_per_mtok: 3, output_per_mtok: 15, cache_read_per_mtok: 0.3, cache_write_per_mtok: 3.75 },
    });
  });

  test('the caller\'s provider steers which catalog entry wins', async () => {
    createProvider({
      id: 'or-1',
      name: 'My Test OpenRouter',
      provider_type: 'openai',
      base_url: 'https://openrouter.ai/api',
      user_id: user.id,
    });
    // Without a provider the exact `openai` entry wins (cache write listed as 0);
    // via OpenRouter its `openai/gpt-4.1` entry wins (no cache-write rate).
    const plain = await request(makeApp()).get('/v1/models/info').query({ model: 'gpt-4.1' });
    expect(plain.body.pricing.cache_write_per_mtok).toBe(0);

    const res = await request(makeApp()).get('/v1/models/info').query({ model: 'gpt-4.1', provider: 'or-1' });
    expect(res.status).toBe(200);
    expect(res.body.pricing).toEqual({
      input_per_mtok: 2,
      output_per_mtok: 8,
      cache_read_per_mtok: 0.5,
      cache_write_per_mtok: null,
    });
  });

  test('local providers get no catalog pricing; other users\' providers are ignored', async () => {
    createProvider({ id: 'local-1', name: 'Local Test Server', provider_type: 'openai', base_url: 'http://localhost:1234', user_id: user.id });
    createProvider({ id: 'local-2', name: 'Theirs', provider_type: 'openai', base_url: 'http://localhost:1234', user_id: otherUser.id });

    const local = await request(makeApp()).get('/v1/models/info').query({ model: 'gpt-4.1', provider: 'local-1' });
    expect(local.status).toBe(200);
    expect(local.body.pricing).toBeNull();
    expect(local.body.context_window).toBe(1047576);

    const foreign = await request(makeApp()).get('/v1/models/info').query({ model: 'gpt-4.1', provider: 'local-2' });
    expect(foreign.status).toBe(200);
    expect(foreign.body.pricing).not.toBeNull();
  });

  test('unknown model answers 200 with nulls', async () => {
    const res = await request(makeApp()).get('/v1/models/info').query({ model: 'definitely-not-a-model-xyz' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      model: 'definitely-not-a-model-xyz',
      context_window: null,
      max_output_tokens: null,
      pricing: null,
    });
  });

  test('missing model is a 400 with a structured error', async () => {
    const res = await request(makeApp()).get('/v1/models/info');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_request', message: expect.any(String) });
  });
});
