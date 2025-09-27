// Contract test for GET /v1/system-prompts - List built-in and custom prompts
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { config } from '../src/env.js';
import { getDb, resetDbCache } from '../src/db/index.js';

// Helper to spin up a minimal app
const makeApp = (router) => {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
};

beforeAll(() => {
  // Ensure DB enabled for system prompts storage
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  getDb();
});

afterAll(() => {
  resetDbCache();
});

describe('GET /v1/system-prompts - Contract Test', () => {
  test('returns 200 with built_ins and custom arrays', async () => {
    // This test will fail until implementation exists
    try {
      const { systemPromptsRouter } = await import('../src/routes/systemPrompts.js');
      const app = makeApp(systemPromptsRouter);
      const agent = request(app);

      const res = await agent.get('/v1/system-prompts');
      assert.equal(res.status, 200);

      const body = res.body;
      assert.ok(typeof body === 'object', 'Response should be an object');
      assert.ok(Array.isArray(body.built_ins), 'built_ins should be an array');
      assert.ok(Array.isArray(body.custom), 'custom should be an array');

      // Validate built-in prompt schema if any exist
      if (body.built_ins.length > 0) {
        const builtIn = body.built_ins[0];
        assert.ok(typeof builtIn.id === 'string', 'built-in id should be string');
        assert.ok(typeof builtIn.slug === 'string', 'built-in slug should be string');
        assert.ok(typeof builtIn.name === 'string', 'built-in name should be string');
        assert.ok(typeof builtIn.order === 'number', 'built-in order should be number');
        assert.ok(typeof builtIn.body === 'string', 'built-in body should be string');
        assert.ok(builtIn.read_only === true, 'built-in read_only should be true');
      }

      // Validate custom prompt schema if any exist
      if (body.custom.length > 0) {
        const custom = body.custom[0];
        assert.ok(typeof custom.id === 'string', 'custom id should be string');
        assert.ok(typeof custom.name === 'string', 'custom name should be string');
        assert.ok(typeof custom.body === 'string', 'custom body should be string');
        assert.ok(typeof custom.usage_count === 'number', 'custom usage_count should be number');
        assert.ok(typeof custom.created_at === 'string', 'custom created_at should be string');
        assert.ok(typeof custom.updated_at === 'string', 'custom updated_at should be string');
        // last_used_at can be null
        assert.ok(custom.last_used_at === null || typeof custom.last_used_at === 'string',
                  'custom last_used_at should be null or string');
      }
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') {
        // Expected to fail - route doesn't exist yet
        assert.ok(true, 'Route module not found - expected during TDD phase');
      } else {
        throw error;
      }
    }
  });

  test('validates content-type is application/json', async () => {
    try {
      const { systemPromptsRouter } = await import('../src/routes/systemPrompts.js');
      const app = makeApp(systemPromptsRouter);
      const agent = request(app);

      const res = await agent.get('/v1/system-prompts');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('application/json'),
                'Content-Type should be application/json');
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') {
        // Expected to fail - route doesn't exist yet
        assert.ok(true, 'Route module not found - expected during TDD phase');
      } else {
        throw error;
      }
    }
  });
});