// Behavior tests for /v1/tools endpoint
import assert from 'node:assert/strict';
import express from 'express';
import { chatRouter } from '../src/routes/chat.js';

const makeApp = () => {
  const app = express();
  app.use(express.json());
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
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.tools), 'tools array present');
      assert.ok(Array.isArray(body.available_tools), 'available_tools array present');
      // Should list both built-in tools
      assert.ok(body.available_tools.includes('get_time'));
      assert.ok(body.available_tools.includes('web_search'));
      // Tool specs should include function definitions
      const names = body.tools.map(t => t?.function?.name).filter(Boolean);
      assert.ok(names.includes('get_time'));
      assert.ok(names.includes('web_search'));
    });
  });
});

