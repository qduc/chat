import express from 'express';
import { test, expect } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { getDb } from '../../src/db/index.js';
import { config } from '../../src/env.js';

export const TEST_USER_ID = 'test-user';
export const TEST_USER_EMAIL = 'test-user@example.com';
export const TEST_SESSION_ID = 'test-session';

export function makeAuthedApp(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

export function getTestAuthToken() {
  ensureTestUser();
  const secret = config.auth.jwtSecret || 'development-secret-key-change-in-production';
  return jwt.sign({ userId: TEST_USER_ID }, secret);
}

export function makeAuthedRequest(agent, method, path) {
  return agent[method](path).set('Authorization', `Bearer ${getTestAuthToken()}`);
}

export function ensureTestUser() {
  const db = getDb();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, email_verified)
     VALUES (@id, @email, @password_hash, @display_name, @email_verified)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       password_hash = excluded.password_hash,
       display_name = excluded.display_name,
       email_verified = excluded.email_verified,
       updated_at = CURRENT_TIMESTAMP`
  ).run({
    id: TEST_USER_ID,
    email: TEST_USER_EMAIL,
    password_hash: '$2b$10$testhashedpasswordforprompts', // Not used in tests
    display_name: 'Test User',
    email_verified: 1
  });
}

export function ensureTestSession() {
  ensureTestUser();
  const db = getDb();
  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at)
     VALUES (@id, @user_id, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id`
  ).run({
    id: TEST_SESSION_ID,
    user_id: TEST_USER_ID
  });
}

export function ensureTestConversation(conversationId = 'test-conversation') {
  const db = getDb();
  ensureTestSession();
  db.prepare(
    `INSERT INTO conversations (id, session_id, user_id, title, model, metadata, created_at, updated_at)
     VALUES (@id, @session_id, @user_id, @title, @model, json(@metadata), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       session_id = excluded.session_id,
       user_id = excluded.user_id,
       metadata = excluded.metadata,
       updated_at = CURRENT_TIMESTAMP`
  ).run({
    id: conversationId,
    session_id: TEST_SESSION_ID,
    user_id: TEST_USER_ID,
    title: 'Prompt Manager Conversation',
    model: 'gpt-4.1-mini',
    metadata: '{}'
  });
}

export function seedCustomPrompt({ id, name, body, userId = TEST_USER_ID }) {
  ensureTestUser();
  const db = getDb();
  db.prepare(
    `INSERT INTO system_prompts (id, user_id, name, body, usage_count, last_used_at, created_at, updated_at)
     VALUES (@id, @user_id, @name, @body, 0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       user_id = excluded.user_id,
       name = excluded.name,
       body = excluded.body,
       updated_at = CURRENT_TIMESTAMP`
  ).run({
    id,
    user_id: userId,
    name,
    body
  });

  return db
    .prepare(
      `SELECT id, name, body, usage_count, last_used_at, created_at, updated_at
       FROM system_prompts WHERE id = @id`
    )
    .get({ id });
}

test('system prompts test utils exports helpers', () => {
  expect(typeof makeAuthedApp).toBe('function');
  expect(typeof ensureTestUser).toBe('function');
});
