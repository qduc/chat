import { describe, expect, test, beforeEach, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { userSettingsRouter } from '../src/routes/userSettings.js';
import { config } from '../src/env.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import { getDb, resetDbCache } from '../src/db/index.js';
import { createUser } from '../src/db/users.js';
import { generateAccessToken } from '../src/middleware/auth.js';

let authHeader = null;
let testUser = null;

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
  app.use(userSettingsRouter);
  return app;
};

beforeEach(() => {
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  const db = getDb();
  db.exec('DELETE FROM user_settings; DELETE FROM users;');

  testUser = createUser({ email: 'settings@example.com', passwordHash: 'pw', displayName: 'Settings User' });
  const token = generateAccessToken(testUser);
  authHeader = `Bearer ${token}`;
});

afterAll(() => {
  resetDbCache();
});

describe('User Settings - custom request params', () => {
  test('stores and returns custom request params presets', async () => {
    const app = makeApp();
    const payload = [
      {
        id: 'thinking-on',
        label: 'Thinking on',
        params: { chat_template_kwargs: { enable_thinking: 1 } },
      },
    ];

    const putRes = await request(app)
      .put('/v1/user-settings')
      .send({ custom_request_params: payload });

    expect(putRes.status).toBe(200);
    expect(putRes.body.updated.custom_request_params).toEqual(payload);

    const getRes = await request(app).get('/v1/user-settings');
    expect(getRes.status).toBe(200);
    expect(getRes.body.custom_request_params).toEqual(payload);
  });

  test('rejects invalid JSON for custom request params', async () => {
    const app = makeApp();

    const res = await request(app)
      .put('/v1/user-settings')
      .send({ custom_request_params: '{invalid json' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_value');
  });
});
