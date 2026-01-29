// Test that all metadata is persisted when regenerating or editing messages
import assert from 'node:assert/strict';
import { config } from '../src/env.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import {
  getDb,
  upsertSession,
  createConversation,
  insertUserMessage,
  getConversationById,
  resetDbCache,
  forkConversationFromMessage,
} from '../src/db/index.js';

const sessionId = 'sess-meta-persist';
const userId = 'user-meta-persist-1';
const userEmail = 'metapersist@example.com';

beforeAll(() => {
  // Safety check: ensure we're using a test database
  safeTestSetup();
});

beforeEach(() => {
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  const db = getDb();
  db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM sessions; DELETE FROM users;');
  upsertSession(sessionId, { userId });

  const now = new Date().toISOString();

  // Create test user
  db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at, email_verified, last_login_at, deleted_at)
    VALUES (@id, @email, @password_hash, @display_name, @created_at, @updated_at, @email_verified, @last_login_at, @deleted_at)
  `).run({
    id: userId,
    email: userEmail,
    password_hash: 'hash',
    display_name: 'Meta Persist User',
    created_at: now,
    updated_at: now,
    email_verified: 1,
    last_login_at: now,
    deleted_at: null
  });

  // Create test provider
  db.prepare(`
    INSERT INTO providers (id, user_id, name, provider_type, base_url)
    VALUES (@id, @userId, @name, @provider_type, @base_url)
  `).run({
    id: 'openai',
    userId: userId,
    name: 'OpenAI',
    provider_type: 'openai',
    base_url: 'https://api.openai.com/v1'
  });
});

afterAll(() => {
  resetDbCache();
});

describe('Conversation metadata persistence on fork', () => {
  test('forks conversation with all metadata when editing a message', () => {
    // Create a conversation with full metadata
    const convId = 'conv-meta-fork-1';
    createConversation({
      id: convId,
      sessionId,
      userId,
      title: 'Original Conversation',
      model: 'gpt-4',
      provider_id: 'openai',
      streamingEnabled: true,
      toolsEnabled: true,
      reasoningEffort: 'high',
      verbosity: 'high',
      metadata: {
        system_prompt: 'You are a helpful assistant.',
        active_tools: ['web_search', 'get_time']
      }
    });

    // Add a message
    insertUserMessage({ conversationId: convId, content: 'Original message', seq: 1 });

    // Fork the conversation (simulating edit behavior)
    const newConvId = forkConversationFromMessage({
      originalConversationId: convId,
      sessionId,
      userId,
      messageSeq: 1,
      title: 'Original Conversation',
      provider_id: 'openai',
      model: 'gpt-4'
    });

    // Verify new conversation was created
    assert.ok(newConvId, 'Should return new conversation ID');

    // Fetch the new conversation and verify all metadata was copied
    const newConvo = getConversationById({
      id: newConvId,
      sessionId,
      userId
    });

    assert.ok(newConvo, 'New conversation should exist');
    assert.strictEqual(newConvo.title, 'Original Conversation', 'Title should be copied');
    assert.strictEqual(newConvo.model, 'gpt-4', 'Model should be copied');
    assert.strictEqual(newConvo.provider_id, 'openai', 'Provider ID should be copied');
    assert.ok(newConvo.streaming_enabled, 'Streaming enabled should be copied');
    assert.ok(newConvo.tools_enabled, 'Tools enabled should be copied');
    assert.strictEqual(newConvo.reasoning_effort, 'high', 'Reasoning effort should be copied');
    assert.strictEqual(newConvo.verbosity, 'high', 'Verbosity should be copied');

    // Verify metadata is copied
    const metadata = typeof newConvo.metadata === 'string'
      ? JSON.parse(newConvo.metadata)
      : newConvo.metadata || {};
    assert.strictEqual(metadata.system_prompt, 'You are a helpful assistant.', 'System prompt should be copied');
    assert.deepStrictEqual(metadata.active_tools, ['web_search', 'get_time'], 'Active tools should be copied');
  });
});
