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

      // Verify response structure
      assert.ok(Array.isArray(body.tools), 'tools array present');
      assert.ok(Array.isArray(body.available_tools), 'available_tools array present');

      // Verify that at least some tools are registered
      assert.ok(body.available_tools.length > 0, 'at least one tool should be available');
      assert.ok(body.tools.length > 0, 'at least one tool spec should be present');

      // Verify both arrays have the same length
      assert.equal(
        body.tools.length,
        body.available_tools.length,
        'tools and available_tools should have matching counts'
      );

      // Verify tool specs have proper structure (OpenAI format)
      for (const tool of body.tools) {
        assert.ok(tool.type === 'function', 'tool should have type "function"');
        assert.ok(tool.function, 'tool should have function property');
        assert.ok(typeof tool.function.name === 'string', 'tool function should have name');
        assert.ok(typeof tool.function.description === 'string', 'tool function should have description');
        assert.ok(tool.function.parameters, 'tool function should have parameters');
      }

      // Verify consistency: all tool names in specs should be in available_tools
      const specNames = body.tools.map((t) => t?.function?.name).filter(Boolean);
      for (const name of specNames) {
        assert.ok(body.available_tools.includes(name), `tool spec name "${name}" should be in available_tools`);
      }

      // Verify all available_tools have corresponding specs
      for (const toolName of body.available_tools) {
        assert.ok(specNames.includes(toolName), `available tool "${toolName}" should have a corresponding spec`);
      }
    });
  });
});
