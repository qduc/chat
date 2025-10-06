/**
 * Test to reproduce the regenerate message duplication bug
 */

import { ConversationManager } from '../src/lib/persistence/ConversationManager.js';
import { getAllMessagesForSync } from '../src/db/messages.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import { getDb, resetDbCache } from '../src/db/index.js';

describe('Regenerate Message Duplication Bug', () => {
  let manager;
  let conversationId;
  const userId = 'test-user-123';
  const sessionId = 'test-session-123';

  beforeAll(() => {
    safeTestSetup();
  });

  beforeEach(() => {
    resetDbCache();
    const db = getDb();
    db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM sessions; DELETE FROM providers;');

    manager = new ConversationManager();

    // Create a test conversation
    conversationId = manager.createNewConversation({
      sessionId,
      userId,
      model: 'gpt-4',
      providerId: 'default-provider',
      streamingEnabled: true,
      toolsEnabled: false
    });
  });

  afterEach(() => {
    const db = getDb();
    db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM sessions; DELETE FROM providers;');
  });

  it('should not duplicate user message when regenerating assistant response', () => {
    // STEP 1: Initial message exchange (like first "hi")
    // Frontend sends: [{role: 'user', content: 'hi', seq: 1}]
    const initialMessages = [
      { role: 'user', content: 'hi', seq: 1 }
    ];

    // Backend processes with afterSeq = max(0, 1-1) = 0
    manager.syncMessageHistoryDiff(conversationId, userId, initialMessages, 0);

    // Then assistant response is added
    const assistantSeq = manager.getNextSequence(conversationId);
    manager.recordAssistantMessage({
      conversationId,
      content: 'This is the first time you have said "hi" to me in this conversation.',
      seq: assistantSeq,
      finishReason: 'stop'
    });

    // Verify initial state: 2 messages (user + assistant)
    let messages = getAllMessagesForSync({ conversationId });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].seq).toBe(1);
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].seq).toBe(2);

    // STEP 2: User clicks regenerate
    // Frontend sends same user message: [{role: 'user', content: 'hi', seq: 1}]
    const regenerateMessages = [
      { role: 'user', content: 'hi', seq: 1 }
    ];

    // Backend processes with afterSeq = max(0, 1-1) = 0
    manager.syncMessageHistoryDiff(conversationId, userId, regenerateMessages, 0);

    // Verify: Should still have only 1 user message
    messages = getAllMessagesForSync({ conversationId });
    const userMessages = messages.filter(m => m.role === 'user');

    // BUG: This will fail if user message is duplicated
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content).toBe('hi');
    expect(userMessages[0].seq).toBe(1);

    // Assistant message should be deleted
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    expect(assistantMessages).toHaveLength(0);
  });
});
