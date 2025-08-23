// Tests for health endpoint observable behaviors


import assert from 'node:assert/strict';
import express from 'express';
import { healthRouter } from '../src/routes/health.js';
import { config } from '../src/env.js';

const makeApp = () => {
  const app = express();
  app.use(healthRouter);
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

test('GET /healthz responds with 200 and { status: "ok" }', async () => {
  const app = makeApp();
  await withServer(app, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  });
});

test('includes service metadata: provider, model, uptime', async () => {
  const app = makeApp();
  await withServer(app, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.ok(body.provider, 'provider is present');
    assert.equal(body.provider, 'openai-compatible');

    assert.ok(body.model, 'model is present');
    assert.equal(body.model, config.defaultModel);

    assert.ok(
      typeof body.uptime === 'number' && !Number.isNaN(body.uptime),
      'uptime is a number'
    );
  });
});

test('includes persistence flags: enabled and retentionDays', async () => {
  const app = makeApp();
  await withServer(app, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.ok(body.persistence, 'persistence object is present');
    assert.strictEqual(typeof body.persistence.enabled, 'boolean');
    assert.strictEqual(typeof body.persistence.retentionDays, 'number');
  });
});
