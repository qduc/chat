import assert from 'node:assert/strict';
import { config } from '../src/env.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import {
  createConversation,
  getDb,
  getConversationBranches,
  getRevisionCountsForConversation,
  getMessageRevisions,
  getMessagesPage,
  insertAssistantFinal,
  insertUserMessage,
  resetDbCache,
  upsertSession,
} from '../src/db/index.js';
import { ConversationManager } from '../src/lib/persistence/ConversationManager.js';

const sessionId = 'sess-regenerate-revision';
const userId = 'user-regenerate-revision';
const userEmail = 'regen@example.com';

beforeAll(() => {
  safeTestSetup();
});

beforeEach(() => {
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  const db = getDb();
  db.exec('DELETE FROM messages; DELETE FROM conversation_branches; DELETE FROM conversations; DELETE FROM sessions; DELETE FROM users;');
  upsertSession(sessionId, { userId });

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at, email_verified, last_login_at, deleted_at)
    VALUES (@id, @email, @password_hash, @display_name, @created_at, @updated_at, @email_verified, @last_login_at, @deleted_at)
  `).run({
    id: userId,
    email: userEmail,
    password_hash: 'hash',
    display_name: 'Regen User',
    created_at: now,
    updated_at: now,
    email_verified: 1,
    last_login_at: now,
    deleted_at: null,
  });
});

afterAll(() => {
  resetDbCache();
});

describe('ConversationManager regenerate branches', () => {
  test('creates a regenerate branch without deleting the original messages', () => {
    const convId = 'conv-regenerate';
    createConversation({
      id: convId,
      sessionId,
      userId,
      title: 'Branch me',
      model: 'gpt-4o',
      provider_id: 'openai',
    });

    insertUserMessage({
      conversationId: convId,
      content: 'Original question',
      seq: 1,
      clientMessageId: 'user-1',
    });
    insertAssistantFinal({
      conversationId: convId,
      content: 'Original answer',
      seq: 2,
      finishReason: 'stop',
      clientMessageId: 'assistant-1',
    });

    const manager = new ConversationManager();
    const result = manager.syncMessageHistoryDiff(
      convId,
      userId,
      [{ id: 'user-1', role: 'user', content: 'Original question', seq: 1 }],
      0
    );

    assert.strictEqual(result.conversationId, convId);
    assert.deepStrictEqual(result.regenerateRevision, {
      anchorMessageId: 'user-1',
      count: 1,
    });

    const conversation = getMessagesPage({ conversationId: convId, limit: 10 });
    assert.strictEqual(conversation.messages.length, 1);
    assert.strictEqual(conversation.messages[0].id, 'user-1');

    const branches = getConversationBranches({ conversationId: convId, userId });
    assert.strictEqual(branches.length, 2);
    assert.strictEqual(branches.filter((branch) => branch.operation_type === 'regenerate').length, 1);

    const revisions = getMessageRevisions({
      conversationId: convId,
      anchorMessageId: 'user-1',
      userId,
    });
    assert.strictEqual(revisions.length, 1);
    assert.strictEqual(revisions[0].operation_type, 'regenerate');
    assert.strictEqual(revisions[0].anchor_content, 'Original question');
    assert.strictEqual(revisions[0].follow_ups.length, 1);
    assert.strictEqual(String(revisions[0].follow_ups[0].content), 'Original answer');
  });

  test('surfaces regenerate counts from visible branch history', () => {
    const convId = 'conv-regenerate-counts';
    createConversation({
      id: convId,
      sessionId,
      userId,
      title: 'Visible regen',
      model: 'gpt-4o',
      provider_id: 'openai',
    });

    insertUserMessage({
      conversationId: convId,
      content: 'A1',
      seq: 1,
      clientMessageId: 'user-1',
    });
    insertAssistantFinal({
      conversationId: convId,
      content: 'B1',
      seq: 2,
      finishReason: 'stop',
      clientMessageId: 'assistant-1',
    });

    const manager = new ConversationManager();
    manager.syncMessageHistoryDiff(
      convId,
      userId,
      [{ id: 'user-1', role: 'user', content: 'A1', seq: 1 }],
      0
    );

    assert.deepStrictEqual(getRevisionCountsForConversation({ conversationId: convId, userId }), {
      edit: {},
      regenerate: { 'user-1': 1 },
    });
  });
});
