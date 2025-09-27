// Shared test utilities for chat proxy tests
import express from 'express';
import { chatRouter } from '../src/routes/chat.js';
import { sessionResolver } from '../src/middleware/session.js';
import { config } from '../src/env.js';
import { getDb } from '../src/db/index.js';

// Mock upstream server for testing
export class MockUpstream {
  constructor() {
    this.app = express();
    this.server = null;
    this.port = null;
    this.shouldError = false;
    this.sockets = new Set();
    this.lastChatRequestBody = null;
    this.lastChatRequestHeaders = null;
    this.lastResponsesRequestBody = null;
    this.setupRoutes();
  }

  setupRoutes() {
    this.app.use(express.json());

    // Mock OpenAI Chat Completions endpoint
    this.app.post('/v1/chat/completions', (req, res) => {
      this.lastChatRequestBody = req.body;
      this.lastChatRequestHeaders = req.headers;
      if (this.shouldError) {
        return res.status(500).json({ error: 'upstream_error' });
      }

      if (req.body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
        res.write('data: {"choices":[{"delta":{"content":" world"}}]}\n\n');
        res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.json({
          id: 'chat_123',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-3.5-turbo',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'Hello world' },
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
        });
      }
    });

    // Mock Responses API endpoint
    this.app.post('/v1/responses', (req, res) => {
      this.lastResponsesRequestBody = req.body;
      if (this.shouldError) {
        return res.status(500).json({ error: 'upstream_error' });
      }

      if (req.body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write('data: {"type":"response.output_text.delta","delta":"Hello","item_id":"item_123"}\n\n');
        res.write('data: {"type":"response.output_text.delta","delta":" world","item_id":"item_123"}\n\n');
        res.write('data: {"type":"response.completed","response":{"id":"resp_123","model":"gpt-3.5-turbo"}}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.json({
          id: 'resp_123',
          output: [{ content: [{ text: 'Hello world' }] }],
          status: 'completed',
          model: 'gpt-3.5-turbo',
          created_at: Math.floor(Date.now() / 1000),
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
        });
      }
    });
  }

  async start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(0, () => {
        this.port = this.server.address().port;
        resolve();
      });

      // Track sockets so we can force-close them in tests
      this.server.on('connection', (socket) => {
        this.sockets.add(socket);
        socket.on('close', () => this.sockets.delete(socket));
      });
    });
  }

  async stop() {
    if (this.server) {
      // Destroy any open keep-alive sockets first to avoid open handle leaks
      for (const socket of this.sockets) {
        try { socket.destroy(); } catch {}
      }
      this.sockets.clear();

      return new Promise((resolve) => {
        this.server.close((err) => {
          if (err) {
            console.warn('Error closing server:', err);
          }
          this.server = null;
          this.port = null;
          resolve();
        });
      });
    }
  }

  setError(shouldError) {
    this.shouldError = shouldError;
  }

  getUrl() {
    return `http://127.0.0.1:${this.port}`;
  }
}

export const makeApp = (options = {}) => {
  const opts = typeof options === 'boolean' ? { useSession: options } : options;
  const { useSession = true, mockUser = null } = opts;

  const app = express();
  app.use(express.json());
  if (useSession) app.use(sessionResolver);
  if (mockUser) {
    app.use((req, _res, next) => {
      req.user = mockUser;
      next();
    });
  }
  app.use(chatRouter);
  return app;
};

export const withServer = async (app, fn) => {
  const srv = app.listen(0);
  const sockets = new Set();
  srv.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise(resolve => srv.on('listening', resolve));
  const port = srv.address().port;
  try {
    return await fn(port);
  } finally {
    // Ensure any lingering keep-alive sockets are torn down before closing
    for (const s of sockets) {
      try { s.destroy(); } catch {}
    }
    sockets.clear();
    await new Promise(resolve => srv.close(resolve));
  }
};

// Registers shared hooks and returns helpers for a test file
export function createChatProxyTestContext() {
  const upstream = new MockUpstream();
  let originalBaseUrl;
  let originalApiKey;
  let originalModel;
  let originalProviderBaseUrl;
  let originalProviderApiKey;

  beforeAll(async () => {
    await upstream.start();

    // Save originals
    originalBaseUrl = config.openaiBaseUrl;
    originalApiKey = config.openaiApiKey;
    originalModel = config.defaultModel;
    originalProviderBaseUrl = config.providerConfig.baseUrl;
    originalProviderApiKey = config.providerConfig.apiKey;

    // Apply test config
    config.openaiBaseUrl = upstream.getUrl();
    config.openaiApiKey = 'test-key';
    config.defaultModel = 'gpt-3.5-turbo';
    config.providerConfig.baseUrl = upstream.getUrl();
    config.providerConfig.apiKey = 'test-key';
  });

  afterAll(async () => {
    await upstream.stop();

    // Close any open DB connections
    const db = getDb();
    if (db) db.close();

    // Restore config
    config.openaiBaseUrl = originalBaseUrl;
    config.openaiApiKey = originalApiKey;
    config.defaultModel = originalModel;
    config.providerConfig.baseUrl = originalProviderBaseUrl;
    config.providerConfig.apiKey = originalProviderApiKey;
  });

  beforeEach(() => {
    upstream.setError(false);
    upstream.lastChatRequestBody = null;
    upstream.lastChatRequestHeaders = null;
    upstream.lastResponsesRequestBody = null;
    config.persistence.enabled = true;
    config.persistence.dbUrl = 'file::memory:';

    if (config.persistence.enabled) {
      const db = getDb();
      if (db) {
        db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM sessions;');
      }
    }
  });

  afterEach(async () => {
    if (config.persistence.enabled) {
      const { resetDbCache } = await import('../src/db/index.js');
      resetDbCache();
    }
  });

  return { upstream, makeApp, withServer };
}
