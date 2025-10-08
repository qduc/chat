// Behavior tests for /v1/tools endpoint
import assert from 'node:assert/strict';
import express from 'express';
import { chatRouter } from '../src/routes/chat.js';
import { generateAccessToken } from '../src/middleware/auth.js';
import * as users from '../src/db/users.js';
import { resetDbCache } from '../src/db/index.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';

let authHeader;

beforeAll(() => {
  // Safety check: ensure we're using a test database
  safeTestSetup();
});

beforeEach(() => {
  // Reset database and create test user
  resetDbCache();
  const user = users.createUser({ email: 'test@example.com', passwordHash: 'pw', displayName: 'Test' });
  const created = users.getUserById(user.id);
  assert.ok(created, 'User should exist in database after creation');
  const token = generateAccessToken(user);
  authHeader = `Bearer ${token}`;
});

const makeApp = () => {
  const app = express();
  app.use(express.json());
  // Inject Authorization header for authentication
  app.use((req, _res, next) => {
    req.headers['authorization'] = authHeader;
    next();
  });
  app.use(chatRouter);
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

describe('GET /v1/tools', () => {
  test('returns tool specs and available tool names', async () => {
    const app = makeApp();
    await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/tools`);
      if (res.status !== 200) {
        const errorBody = await res.text();
        throw new Error(`Expected status 200 but received ${res.status}. Body: ${errorBody}`);
      }
      const body = await res.json();
      assert.ok(Array.isArray(body.tools), 'tools array present');
      assert.ok(Array.isArray(body.available_tools), 'available_tools array present');
  // Should list all registered tools
      assert.ok(body.available_tools.includes('get_time'));
      assert.ok(body.available_tools.includes('web_search'));
  assert.ok(body.available_tools.includes('web_search_exa'));
      // Tool specs should include function definitions
      const names = body.tools.map(t => t?.function?.name).filter(Boolean);
      assert.ok(names.includes('get_time'));
      assert.ok(names.includes('web_search'));
  assert.ok(names.includes('web_search_exa'));
    });
  });
});

