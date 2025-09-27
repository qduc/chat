import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createUser } from '../src/db/users.js';
import { generateAccessToken } from '../src/middleware/auth.js';
import { resetDbCache, getDb } from '../src/db/index.js';
import { createProvidersRouter } from '../src/routes/providers.js';
import { getUserContext } from '../src/middleware/auth.js';
import { config } from '../src/env.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';

// Helper to create test app with authentication middleware
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(getUserContext); // Add auth context middleware
  app.use(createProvidersRouter());
  return app;
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
  let user1, user2, token1, token2;
  let user1PrivateId, globalSharedId, user1EditableId, user1DefaultId, globalDefaultId;
  let user1ProviderData, user2ProviderData, globalProviderData; // Store provider data for tests

  beforeEach(async () => {
    resetDbCache();
    app = createTestApp();

    // Create test users with hashed passwords and unique emails
    const passwordHash = await bcrypt.hash('password123', 12);
    const timestamp = Date.now();

    user1 = createUser({
      email: `user1-${timestamp}@test.com`,
      passwordHash,
      displayName: 'User 1'
    });
    user2 = createUser({
      email: `user2-${timestamp}@test.com`,
      passwordHash,
      displayName: 'User 2'
    });

    // Generate tokens for authentication
    token1 = generateAccessToken(user1);
    token2 = generateAccessToken(user2);
  });

  afterEach(() => {
    resetDbCache();
  });

  describe('Provider creation and ownership', () => {
    test('authenticated user can create personal provider', async () => {
      const timestamp = Date.now() + Math.random();
      const response = await request(app)
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

    test('anonymous user creates global provider', async () => {
      const timestamp = Date.now() + Math.random();
      const response = await request(app)
        .post('/v1/providers')
        .send({
          id: `global-openai-${timestamp}`,
          name: `Global OpenAI ${timestamp}`,
          provider_type: 'openai',
          api_key: 'sk-global',
        });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe(`Global OpenAI ${timestamp}`);
      expect(response.body.user_id).toBeNull();
    });
  });

  describe('Provider listing and visibility', () => {
    beforeEach(async () => {
      // Create test providers with unique IDs based on timestamp
      const timestamp = Date.now() + Math.random();

      // User1's personal provider
      const user1Response = await request(app)
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
      const user2Response = await request(app)
        .post('/v1/providers')
        .set('Authorization', `Bearer ${token2}`)
        .send({
          id: `user2-provider-${timestamp}`,
          name: `User2 Personal ${timestamp}`,
          provider_type: 'anthropic',
          api_key: 'sk-user2',
        });
      user2ProviderData = user2Response.body;

      // Global provider (created by anonymous user)
      const globalResponse = await request(app)
        .post('/v1/providers')
        .send({
          id: `global-provider-${timestamp}`,
          name: `Global Provider ${timestamp}`,
          provider_type: 'openai',
          api_key: 'sk-global',
        });
      globalProviderData = globalResponse.body;
    });

    test('user1 sees their own providers + global providers', async () => {
      const response = await request(app)
        .get('/v1/providers')
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(200);
      const providerNames = response.body.providers.map(p => p.name);

      // User1 should see their personal provider, global provider, but NOT user2's provider
      expect(providerNames).toContain(user1ProviderData.name);
      expect(providerNames).toContain(globalProviderData.name);
      expect(providerNames).not.toContain(user2ProviderData.name);
    });

    test('user2 sees their own providers + global providers', async () => {
      const response = await request(app)
        .get('/v1/providers')
        .set('Authorization', `Bearer ${token2}`);

      expect(response.status).toBe(200);
      const providerNames = response.body.providers.map(p => p.name);

      // User2 should see their personal provider, global provider, but NOT user1's provider
      expect(providerNames).toContain(user2ProviderData.name);
      expect(providerNames).toContain(globalProviderData.name);
      expect(providerNames).not.toContain(user1ProviderData.name);
    });

    test('anonymous user only sees global providers', async () => {
      const response = await request(app)
        .get('/v1/providers');

      expect(response.status).toBe(200);
      const providerNames = response.body.providers.map(p => p.name);

      // Anonymous user should only see global providers
      expect(providerNames).toContain(globalProviderData.name);
      expect(providerNames).not.toContain(user1ProviderData.name);
      expect(providerNames).not.toContain(user2ProviderData.name);
    });

    test('providers include is_user_provider flag', async () => {
      const response = await request(app)
        .get('/v1/providers')
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(200);

      const user1Provider = response.body.providers.find(p => p.name === user1ProviderData.name);
      const globalProvider = response.body.providers.find(p => p.name === globalProviderData.name);

      expect(user1Provider.is_user_provider).toBe(true);
      expect(globalProvider.is_user_provider).toBe(false);
    });
  });

  describe('Provider access control', () => {
    let user1PrivateData, globalSharedData;

    beforeEach(async () => {
      // Create test providers with unique IDs
      const timestamp = Date.now() + Math.random();
      user1PrivateId = `user1-private-${timestamp}`;
      globalSharedId = `global-shared-${timestamp}`;

      const user1Response = await request(app)
        .post('/v1/providers')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          id: user1PrivateId,
          name: `User1 Private ${timestamp}`,
          provider_type: 'openai',
          api_key: 'sk-user1-private',
        });
      user1PrivateData = user1Response.body;

      const globalResponse = await request(app)
        .post('/v1/providers')
        .send({
          id: globalSharedId,
          name: `Global Shared ${timestamp}`,
          provider_type: 'openai',
          api_key: 'sk-global-shared',
        });
      globalSharedData = globalResponse.body;
    });

    test('user can access their own provider', async () => {
      const response = await request(app)
        .get(`/v1/providers/${user1PrivateId}`)
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe(user1PrivateData.name);
    });

    test('user cannot access another users provider', async () => {
      const response = await request(app)
        .get(`/v1/providers/${user1PrivateId}`)
        .set('Authorization', `Bearer ${token2}`);

      expect(response.status).toBe(404);
    });

    test('user can access global provider', async () => {
      const response = await request(app)
        .get(`/v1/providers/${globalSharedId}`)
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe(globalSharedData.name);
    });

    test('anonymous user cannot access user provider', async () => {
      const response = await request(app)
        .get(`/v1/providers/${user1PrivateId}`);

      expect(response.status).toBe(404);
    });

    test('anonymous user can access global provider', async () => {
      const response = await request(app)
        .get(`/v1/providers/${globalSharedId}`);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe(globalSharedData.name);
    });
  });

  describe('Provider modification control', () => {
    let user1EditableData;

    beforeEach(async () => {
      // Create test providers with unique IDs
      const timestamp = Date.now() + Math.random();
      user1EditableId = `user1-editable-${timestamp}`;

      const response = await request(app)
        .post('/v1/providers')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          id: user1EditableId,
          name: `User1 Editable ${timestamp}`,
          provider_type: 'openai',
          api_key: 'sk-user1-edit',
        });
      user1EditableData = response.body;
    });

    test('user can update their own provider', async () => {
      const response = await request(app)
        .put(`/v1/providers/${user1EditableId}`)
        .set('Authorization', `Bearer ${token1}`)
        .send({
          name: `User1 Updated ${Date.now()}`,
        });

      expect(response.status).toBe(200);
      expect(response.body.name).toContain('User1 Updated');
    });

    test('user cannot update another users provider', async () => {
      const response = await request(app)
        .put(`/v1/providers/${user1EditableId}`)
        .set('Authorization', `Bearer ${token2}`)
        .send({
          name: 'Hacked Name',
        });

      expect(response.status).toBe(404);
    });

    test('user can delete their own provider', async () => {
      const response = await request(app)
        .delete(`/v1/providers/${user1EditableId}`)
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(204);
    });

    test('user cannot delete another users provider', async () => {
      const response = await request(app)
        .delete(`/v1/providers/${user1EditableId}`)
        .set('Authorization', `Bearer ${token2}`);

      expect(response.status).toBe(404);
    });
  });

  describe('Default provider management', () => {
    let user1DefaultData, globalDefaultData;

    beforeEach(async () => {
      // Create user and global providers with unique IDs
      const timestamp = Date.now() + Math.random();
      user1DefaultId = `user1-default-${timestamp}`;
      globalDefaultId = `global-default-${timestamp}`;

      const user1Response = await request(app)
        .post('/v1/providers')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          id: user1DefaultId,
          name: `User1 Default ${timestamp}`,
          provider_type: 'openai',
          api_key: 'sk-user1-default',
        });
      user1DefaultData = user1Response.body;

      const globalResponse = await request(app)
        .post('/v1/providers')
        .send({
          id: globalDefaultId,
          name: `Global Default ${timestamp}`,
          provider_type: 'openai',
          api_key: 'sk-global-default',
        });
      globalDefaultData = globalResponse.body;
    });

    test('user can set their provider as default', async () => {
      const response = await request(app)
        .post(`/v1/providers/${user1DefaultId}/default`)
        .set('Authorization', `Bearer ${token1}`);

      expect(response.status).toBe(200);
      expect(response.body.is_default).toBe(1);
    });

    test('setting user default does not affect global default', async () => {
      // Set global default
      await request(app)
        .post(`/v1/providers/${globalDefaultId}/default`);

      // Set user default
      await request(app)
        .post(`/v1/providers/${user1DefaultId}/default`)
        .set('Authorization', `Bearer ${token1}`);

      // Check global default is still set for anonymous users
      const globalResponse = await request(app)
        .get('/v1/providers/default');

      expect(globalResponse.status).toBe(200);
      expect(globalResponse.body.name).toBe(globalDefaultData.name);

      // Check user default takes precedence for authenticated user
      const userResponse = await request(app)
        .get('/v1/providers/default')
        .set('Authorization', `Bearer ${token1}`);

      expect(userResponse.status).toBe(200);
      expect(userResponse.body.name).toBe(user1DefaultData.name);
    });
  });
});