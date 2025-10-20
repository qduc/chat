import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { generateAccessToken } from '../src/middleware/auth.js';
import { resetDbCache, getDb } from '../src/db/index.js';
import { createProvidersRouter } from '../src/routes/providers.js';
import { getUserContext } from '../src/middleware/auth.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';

// Helper to create test app with authentication middleware
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(getUserContext); // Add auth context middleware
  app.use(createProvidersRouter());
  return app;
};

const insertTestUser = ({ email, displayName }) => {
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();

  db.prepare(
    `
    INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at, email_verified, last_login_at, deleted_at)
    VALUES (@id, @email, 'test-hash', @display_name, @now, @now, 1, NULL, NULL)
  `
  ).run({ id, email, display_name: displayName || null, now });

  return { id, email, displayName };
};

beforeAll(() => {
  // Safety check: ensure we're using a test database
  safeTestSetup();
  resetDbCache();
  getDb();
});

afterAll(() => {
  resetDbCache();
});

describe('User-scoped Providers', () => {
  let app;
  let server;
  let user1, user2, token1, token2;
  let user1PrivateId, user1EditableId, user1DefaultId;
  let user1ProviderData, user2ProviderData; // Store provider data for tests

  beforeEach(async () => {
    resetDbCache();
    const db = getDb();
    db.exec('DELETE FROM providers; DELETE FROM users;');
    app = createTestApp();
    server = app.listen();

    const timestamp = Date.now();

    user1 = insertTestUser({
      email: `user1-${timestamp}@test.com`,
      displayName: 'User 1',
    });
    user2 = insertTestUser({
      email: `user2-${timestamp}@test.com`,
      displayName: 'User 2',
    });

    // Generate tokens for authentication
    token1 = generateAccessToken(user1);
    token2 = generateAccessToken(user2);
  });

  afterEach(() => {
    resetDbCache();
    if (server && typeof server.close === 'function') {
      server.close();
    }
  });

  describe('Provider creation and ownership', () => {
    test('authenticated user can create personal provider', async () => {
      const timestamp = Date.now() + Math.random();
      const response = await request(server)
        .post('/v1/providers')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          id: `user1-openai-${timestamp}`,
          name: `User1 OpenAI ${timestamp}`,
          provider_type: 'openai',
          api_key: 'sk-test',
        });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe(`User1 OpenAI ${timestamp}`);
      expect(response.body.user_id).toBe(user1.id);
    });
  });

  describe('Provider listing and visibility', () => {
    beforeEach(async () => {
      // Create test providers with unique IDs based on timestamp
      const timestamp = Date.now() + Math.random();

      // User1's personal provider
      const user1Response = await request(server)
        .post('/v1/providers')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          id: `user1-provider-${timestamp}`,
          name: `User1 Personal ${timestamp}`,
          provider_type: 'openai',
          api_key: 'sk-user1',
        });
      user1ProviderData = user1Response.body;

      // User2's personal provider
      const user2Response = await request(server)
        .post('/v1/providers')
        .set('Authorization', `Bearer ${token2}`)
        .send({
          id: `user2-provider-${timestamp}`,
          name: `User2 Personal ${timestamp}`,
          provider_type: 'anthropic',
          api_key: 'sk-user2',
        });
      user2ProviderData = user2Response.body;
    });

    test('user1 sees only their own providers', async () => {
      const response = await request(server).get('/v1/providers').set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(200);
      const providerNames = response.body.providers.map((p) => p.name);

      // User1 should see their personal provider but NOT user2's provider
      expect(providerNames).toContain(user1ProviderData.name);
      expect(providerNames).not.toContain(user2ProviderData.name);
    });

    test('user2 sees only their own providers', async () => {
      const response = await request(server).get('/v1/providers').set('Authorization', `Bearer ${token2}`);

      expect(response.status).toBe(200);
      const providerNames = response.body.providers.map((p) => p.name);

      // User2 should see their personal provider but NOT user1's provider
      expect(providerNames).toContain(user2ProviderData.name);
      expect(providerNames).not.toContain(user1ProviderData.name);
    });
  });

  describe('Provider access control', () => {
    let user1PrivateData;

    beforeEach(async () => {
      // Create test providers with unique IDs
      const timestamp = Date.now() + Math.random();
      user1PrivateId = `user1-private-${timestamp}`;

      const user1Response = await request(server)
        .post('/v1/providers')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          id: user1PrivateId,
          name: `User1 Private ${timestamp}`,
          provider_type: 'openai',
          api_key: 'sk-user1-private',
        });
      user1PrivateData = user1Response.body;
    });

    test('user can access their own provider', async () => {
      const response = await request(server)
        .get(`/v1/providers/${user1PrivateId}`)
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe(user1PrivateData.name);
    });

    test('user cannot access another users provider', async () => {
      const response = await request(server)
        .get(`/v1/providers/${user1PrivateId}`)
        .set('Authorization', `Bearer ${token2}`);

      expect(response.status).toBe(404);
    });
  });

  describe('Provider modification control', () => {
    beforeEach(async () => {
      // Create test providers with unique IDs
      const timestamp = Date.now() + Math.random();
      user1EditableId = `user1-editable-${timestamp}`;

      await request(server)
        .post('/v1/providers')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          id: user1EditableId,
          name: `User1 Editable ${timestamp}`,
          provider_type: 'openai',
          api_key: 'sk-user1-edit',
        });
    });

    test('user can update their own provider', async () => {
      const response = await request(server)
        .put(`/v1/providers/${user1EditableId}`)
        .set('Authorization', `Bearer ${token1}`)
        .send({
          name: `User1 Updated ${Date.now()}`,
        });

      expect(response.status).toBe(200);
      expect(response.body.name).toContain('User1 Updated');
    });

    test('user cannot update another users provider', async () => {
      const response = await request(server)
        .put(`/v1/providers/${user1EditableId}`)
        .set('Authorization', `Bearer ${token2}`)
        .send({
          name: 'Hacked Name',
        });

      expect(response.status).toBe(404);
    });

    test('user can delete their own provider', async () => {
      const response = await request(server)
        .delete(`/v1/providers/${user1EditableId}`)
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(204);
    });

    test('user cannot delete another users provider', async () => {
      const response = await request(server)
        .delete(`/v1/providers/${user1EditableId}`)
        .set('Authorization', `Bearer ${token2}`);

      expect(response.status).toBe(404);
    });
  });

  describe('Default provider management', () => {
    let user1DefaultData;

    beforeEach(async () => {
      // Create user provider with unique ID
      const timestamp = Date.now() + Math.random();
      user1DefaultId = `user1-default-${timestamp}`;

      const user1Response = await request(server)
        .post('/v1/providers')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          id: user1DefaultId,
          name: `User1 Default ${timestamp}`,
          provider_type: 'openai',
          api_key: 'sk-user1-default',
        });
      user1DefaultData = user1Response.body;
    });

    test('user can set their provider as default', async () => {
      const response = await request(server)
        .post(`/v1/providers/${user1DefaultId}/default`)
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(200);
      expect(response.body.is_default).toBe(1);
    });
  });
});
