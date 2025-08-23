// Tests for middleware observable behaviors (rateLimit, sessionResolver)

import assert from 'node:assert/strict';
import { rateLimit } from '../src/middleware/rateLimit.js';
import { sessionResolver } from '../src/middleware/session.js';
import { config } from '../src/env.js';

// Helper to create mock response objects
const createRes = () => {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    body: null,
    setHeader(key, value) {
      headers[key] = String(value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
  };
};

describe('rateLimit middleware', () => {
  beforeEach(() => {
    // Small limit for tests
    config.rate.max = 2;
    config.rate.windowSec = 60;
  });

  test('allows requests under the limit and sets rate headers', () => {
    const req = { ip: '1.1.1.1' };
    const res = createRes();
    let called = false;
    rateLimit(req, res, () => {
      called = true;
    });
    assert.ok(called, 'next() should be called');
    assert.equal(res.headers['X-RateLimit-Limit'], '2');
    assert.equal(res.headers['X-RateLimit-Remaining'], '1');
  });

  test('blocks when exceeding limit with 429 and Retry-After header', () => {
    const req = { ip: '2.2.2.2' };
    const res1 = createRes();
    const res2 = createRes();
    // First two requests pass
    rateLimit(req, res1, () => {});
    rateLimit(req, res2, () => {});
    // Third should be blocked
    const res3 = createRes();
    let nextCalled = false;
    rateLimit(req, res3, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res3.statusCode, 429);
    assert.equal(res3.headers['Retry-After'], '60');
    assert.deepEqual(res3.body, { error: 'rate_limit_exceeded', remaining: 0 });
  });

  test('sets X-RateLimit-Limit and X-RateLimit-Remaining headers accurately', () => {
    const req = { ip: '3.3.3.3' };
    const res1 = createRes();
    rateLimit(req, res1, () => {});
    assert.equal(res1.headers['X-RateLimit-Limit'], '2');
    assert.equal(res1.headers['X-RateLimit-Remaining'], '1');

    const res2 = createRes();
    rateLimit(req, res2, () => {});
    assert.equal(res2.headers['X-RateLimit-Remaining'], '0');
  });
});

describe('sessionResolver middleware', () => {
  test('uses x-session-id header when present', () => {
    const req = {
      header: (name) => (name === 'x-session-id' ? 'abc123' : undefined),
    };
    const res = {};
    let called = false;
    sessionResolver(req, res, () => {
      called = true;
    });
    assert.ok(called);
    assert.equal(req.sessionId, 'abc123');
  });

  test('falls back to cf_session_id cookie when header missing', () => {
    const req = {
      header: (name) =>
        name === 'cookie' ? 'foo=bar; cf_session_id=xyz789; hello=world' : undefined,
    };
    const res = {};
    sessionResolver(req, res, () => {});
    assert.equal(req.sessionId, 'xyz789');
  });

  test('generates a UUID when neither header nor cookie present', () => {
    const req = { header: () => undefined };
    const res = {};
    sessionResolver(req, res, () => {});
    assert.match(
      req.sessionId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      'sessionId should be a UUID v4'
    );
  });
});
