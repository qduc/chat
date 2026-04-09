import assert from 'node:assert/strict';
import { config } from '../src/env.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import {
  createConversationBranch,
  createConversation,
  getDb,
  getConversationBranches,
  getRootBranchId,
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
    assert.strictEqual(revisions[0].follow_ups.length, 0);
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

  test('revision follow-ups stop before later turns for regenerate and edit branches', () => {
    const convId = 'conv-revision-bounds';
    createConversation({
      id: convId,
      sessionId,
      userId,
      title: 'Revision bounds',
      model: 'gpt-4o',
      provider_id: 'openai',
    });

    const user1 = insertUserMessage({
      conversationId: convId,
      content: 'Q1',
      seq: 1,
      clientMessageId: 'user-1',
    });
    insertAssistantFinal({
      conversationId: convId,
      content: 'A1',
      seq: 2,
      finishReason: 'stop',
      clientMessageId: 'assistant-1',
    });
    insertUserMessage({
      conversationId: convId,
      content: 'Q2',
      seq: 3,
      clientMessageId: 'user-2',
    });
    insertAssistantFinal({
      conversationId: convId,
      content: 'A2',
      seq: 4,
      finishReason: 'stop',
      clientMessageId: 'assistant-2',
    });

    const rootBranchId = getRootBranchId(convId);
    const regenerateBranchId = createConversationBranch({
      conversationId: convId,
      userId,
      parentBranchId: rootBranchId,
      branchPointMessageId: user1.id,
      sourceMessageId: user1.id,
      operationType: 'regenerate',
      headMessageId: user1.id,
    });
    insertAssistantFinal({
      conversationId: convId,
      content: 'A1-alt',
      seq: 5,
      finishReason: 'stop',
      clientMessageId: 'assistant-1-alt',
      branchId: regenerateBranchId,
      parentMessageId: user1.id,
    });

    const editBranchId = createConversationBranch({
      conversationId: convId,
      userId,
      parentBranchId: rootBranchId,
      branchPointMessageId: null,
      sourceMessageId: user1.id,
      operationType: 'edit',
      headMessageId: null,
    });
    const editedUser = insertUserMessage({
      conversationId: convId,
      content: 'Q1 edited',
      seq: 6,
      clientMessageId: 'user-1-edit',
      branchId: editBranchId,
      parentMessageId: null,
    });
    insertAssistantFinal({
      conversationId: convId,
      content: 'A1 edited',
      seq: 7,
      finishReason: 'stop',
      clientMessageId: 'assistant-1-edit',
      branchId: editBranchId,
      parentMessageId: editedUser.id,
    });

    const revisions = getMessageRevisions({
      conversationId: convId,
      anchorMessageId: 'user-1',
      userId,
    });

    const regenerateRevision = revisions.find((revision) => revision.operation_type === 'regenerate');
    assert.ok(regenerateRevision);
    assert.deepStrictEqual(regenerateRevision.follow_ups.map((message) => message.content), ['A1-alt']);

    const editRevision = revisions.find((revision) => revision.operation_type === 'edit');
    assert.ok(editRevision);
    assert.equal(editRevision.anchor_content, 'Q1 edited');
    assert.deepStrictEqual(editRevision.follow_ups.map((message) => message.content), ['A1 edited']);
  });
});
