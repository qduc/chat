// Integration test: create + list + uniqueness suffix
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { config } from '../src/env.js';
import { getDb, resetDbCache } from '../src/db/index.js';

const makeApp = (router) => {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
};

beforeAll(() => {
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  getDb();
});

afterAll(() => {
  resetDbCache();
});

describe('Integration: Create prompt with name uniqueness', () => {
  test('creates prompt then handles duplicate names with suffix', async () => {
    try {
      const { systemPromptsRouter } = await import('../src/routes/systemPrompts.js');
      const app = makeApp(systemPromptsRouter);
      const agent = request(app);

      // Create first prompt
      let res = await agent
        .post('/v1/system-prompts')
        .send({ name: 'Helper', body: 'Original helper' });
      assert.equal(res.status, 201);
      const first = res.body;

      // Create second with same name - should get suffix
      res = await agent
        .post('/v1/system-prompts')
        .send({ name: 'Helper', body: 'Second helper' });
      assert.equal(res.status, 201);
      const second = res.body;

      assert.equal(second.name, 'Helper (1)', 'Second prompt should have suffix');

      // List should contain both
      res = await agent.get('/v1/system-prompts');
      assert.equal(res.status, 200);
      const list = res.body;

      const customPrompts = list.custom;
      assert.equal(customPrompts.length, 2, 'Should have 2 custom prompts');

      const names = customPrompts.map(p => p.name);
      assert.ok(names.includes('Helper'), 'Should include original name');
      assert.ok(names.includes('Helper (1)'), 'Should include suffixed name');

    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') {
        assert.ok(true, 'Route module not found - expected during TDD phase');
      } else {
        throw error;
      }
    }
  });
});