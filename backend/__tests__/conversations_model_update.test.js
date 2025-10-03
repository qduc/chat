/**
 * Test conversation model update functionality
 */

import express from 'express';
import request from 'supertest';
import { conversationsRouter } from '../src/routes/conversations.js';
import { chatRouter } from '../src/routes/chat.js';
import { createChatProxyTestContext } from '../test_utils/chatProxyTestUtils.js';
import { sessionResolver } from '../src/middleware/session.js';
import { config } from '../src/env.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import { getDb, resetDbCache, upsertSession } from '../src/db/index.js';
import { createUser } from '../src/db/users.js';
import { generateAccessToken } from '../src/middleware/auth.js';

const TEST_SESSION_ID = 'test-session-model-update';

let authHeader;
let testUser;

const { upstream } = createChatProxyTestContext();

beforeAll(() => {
  // Safety check: ensure we're using a test database
  safeTestSetup();
});

const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use(sessionResolver);
  // Inject an Authorization header with a test token
  app.use((req, _res, next) => {
    if (authHeader) req.headers['authorization'] = authHeader;
    next();
  });
  app.use(conversationsRouter);
  app.use(chatRouter);
  return app;
};

beforeEach(() => {
  // Reset config and database state for each test
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  config.persistence.maxConversationsPerSession = 100;
  resetDbCache();
  const db = getDb();
  db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM sessions; DELETE FROM providers; DELETE FROM users;');

  // Create a test user and generate an access token for authenticated requests
  testUser = createUser({ email: 'modelupdate@test.com', passwordHash: 'hash', displayName: 'Model Update Test User' });
  const token = generateAccessToken(testUser);
  authHeader = `Bearer ${token}`;

  upsertSession(TEST_SESSION_ID);
  db.prepare(`INSERT INTO providers (id, user_id, name, provider_type, base_url) VALUES (@id, @userId, @name, @provider_type, @base_url)`).run({
    id: 'p1',
    userId: testUser.id,
    name: 'p1',
    provider_type: 'openai',
    base_url: upstream.getUrl()
  });
});

afterAll(() => {
  resetDbCache();
});

describe('Conversation Model Update', () => {
  test('should update model when changed in subsequent requests', async () => {
    const app = makeApp();

    // Step 1: Create a new conversation with model 'gpt-3.5-turbo'
    const createRes = await request(app)
      .post('/v1/conversations')
      .set('x-session-id', TEST_SESSION_ID)
      .send({
        title: 'Model Update Test',
        model: 'gpt-3.5-turbo',
        provider_id: 'p1'
      })
      .expect(201);

    const conversationId = createRes.body.id;
    expect(conversationId).toBeTruthy();
    expect(createRes.body.model).toBe('gpt-3.5-turbo');

    // Step 2: Send a chat request with a different model
    await request(app)
      .post('/v1/chat/completions')
      .set('x-session-id', TEST_SESSION_ID)
      .set('x-conversation-id', conversationId)
      .send({
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'Hello, testing model update' }
        ]
      })
      .expect(200);

    // Step 3: Retrieve the conversation and verify model was updated
    const getRes = await request(app)
      .get(`/v1/conversations/${conversationId}`)
      .set('x-session-id', TEST_SESSION_ID)
      .expect(200);

    expect(getRes.body.model).toBe('gpt-4');
    expect(getRes.body.model).not.toBe('gpt-3.5-turbo');
  });

  test('should persist model through multiple requests', async () => {
    const app = makeApp();

    // Step 1: Create a new conversation
    const createRes = await request(app)
      .post('/v1/conversations')
      .set('x-session-id', TEST_SESSION_ID)
      .send({
        title: 'Model Persistence Test',
        model: 'gpt-3.5-turbo',
        provider_id: 'p1'
      })
      .expect(201);

    const conversationId = createRes.body.id;

    // Step 2: Send first message with a new model
    await request(app)
      .post('/v1/chat/completions')
      .set('x-session-id', TEST_SESSION_ID)
      .set('x-conversation-id', conversationId)
      .send({
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'First message' }
        ]
      })
      .expect(200);

    // Step 3: Send second message with yet another model
    await request(app)
      .post('/v1/chat/completions')
      .set('x-session-id', TEST_SESSION_ID)
      .set('x-conversation-id', conversationId)
      .send({
        model: 'gpt-4-turbo',
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'Response' },
          { role: 'user', content: 'Second message' }
        ]
      })
      .expect(200);

    // Step 4: Retrieve the conversation and verify the latest model is saved
    const getRes = await request(app)
      .get(`/v1/conversations/${conversationId}`)
      .set('x-session-id', TEST_SESSION_ID)
      .expect(200);

    expect(getRes.body.model).toBe('gpt-4-turbo');
  });

  test('should not update model if same as existing', async () => {
    const app = makeApp();

    // Step 1: Create a new conversation
    const createRes = await request(app)
      .post('/v1/conversations')
      .set('x-session-id', TEST_SESSION_ID)
      .send({
        title: 'Model No-Change Test',
        model: 'gpt-4',
        provider_id: 'p1'
      })
      .expect(201);

    const conversationId = createRes.body.id;

    // Step 2: Send a message with the same model
    await request(app)
      .post('/v1/chat/completions')
      .set('x-session-id', TEST_SESSION_ID)
      .set('x-conversation-id', conversationId)
      .send({
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'Testing same model' }
        ]
      })
      .expect(200);

    // Step 3: Retrieve the conversation
    const getRes = await request(app)
      .get(`/v1/conversations/${conversationId}`)
      .set('x-session-id', TEST_SESSION_ID)
      .expect(200);

    // Model should still be gpt-4
    expect(getRes.body.model).toBe('gpt-4');
  });
});
