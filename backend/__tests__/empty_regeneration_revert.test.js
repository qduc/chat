import { SimplifiedPersistence } from '../src/lib/simplifiedPersistence.js';
import { config } from '../src/env.js';
import { getDb } from '../src/db/client.js';
import { getActiveBranchId } from '../src/db/branches.js';

const createTestConfig = () => ({
  ...config,
  persistence: {
    ...config.persistence,
    enabled: true,
  },
});

const createRequestStub = () => ({
  header: () => 'test-agent',
});

describe('Empty regeneration branch revert', () => {
  const userId = 'test-user-' + Date.now();
  const sessionId = 'test-session';

  async function createConversation() {
    const persistence = new SimplifiedPersistence(createTestConfig());
    await persistence.initialize({
      conversationId: null,
      sessionId,
      userId,
      req: createRequestStub(),
      bodyIn: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'First message', id: 'msg-1' }],
      },
    });
    // Record assistant response
    persistence.appendContent('First assistant response');
    persistence.recordAssistantFinal();
    return persistence.conversationId;
  }

  test('Reverts and deletes new branch on empty regeneration', async () => {
    const db = getDb();
    const conversationId = await createConversation();
    const originalBranchId = getActiveBranchId({ conversationId, userId });

    // Simulate regeneration: send history minus assistant message
    const persistence = new SimplifiedPersistence(createTestConfig());
    await persistence.initialize({
      conversationId,
      sessionId,
      userId,
      req: createRequestStub(),
      bodyIn: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'First message', id: 'msg-1' }],
      },
    });

    const newBranchId = persistence.activeBranchId;
    expect(newBranchId).not.toBe(originalBranchId);
    expect(persistence.branchOperationType).toBe('regenerate');

    // Record empty final response
    persistence.recordAssistantFinal({ finishReason: 'stop' });

    // 1. Check that active branch has reverted
    const currentBranchId = getActiveBranchId({ conversationId, userId });
    expect(currentBranchId).toBe(originalBranchId);

    // 2. Check that the new (empty) branch has been deleted from DB
    const branchRow = db.prepare('SELECT id FROM conversation_branches WHERE id = ?').get(newBranchId);
    expect(branchRow).toBeUndefined();

    // 3. Check that the draft assistant message was also deleted
    const messageRow = db.prepare('SELECT id FROM messages WHERE branch_id = ?').get(newBranchId);
    expect(messageRow).toBeUndefined();
  });

  test('Reverts and deletes new branch on error with no content during regeneration', async () => {
    const db = getDb();
    const conversationId = await createConversation();
    const originalBranchId = getActiveBranchId({ conversationId, userId });

    // Simulate regeneration
    const persistence = new SimplifiedPersistence(createTestConfig());
    await persistence.initialize({
      conversationId,
      sessionId,
      userId,
      req: createRequestStub(),
      bodyIn: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'First message', id: 'msg-1' }],
      },
    });

    const newBranchId = persistence.activeBranchId;
    
    // Simulate error
    persistence.markError();

    // Check revert and deletion
    const currentBranchId = getActiveBranchId({ conversationId, userId });
    expect(currentBranchId).toBe(originalBranchId);
    const branchRow = db.prepare('SELECT id FROM conversation_branches WHERE id = ?').get(newBranchId);
    expect(branchRow).toBeUndefined();
  });

  test('Does NOT revert if there is content', async () => {
    const db = getDb();
    const conversationId = await createConversation();
    const originalBranchId = getActiveBranchId({ conversationId, userId });

    const persistence = new SimplifiedPersistence(createTestConfig());
    await persistence.initialize({
      conversationId,
      sessionId,
      userId,
      req: createRequestStub(),
      bodyIn: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'First message', id: 'msg-1' }],
      },
    });

    const newBranchId = persistence.activeBranchId;
    
    persistence.appendContent('New content');
    persistence.recordAssistantFinal();

    // Should NOT revert
    const currentBranchId = getActiveBranchId({ conversationId, userId });
    expect(currentBranchId).toBe(newBranchId);
    const branchRow = db.prepare('SELECT id FROM conversation_branches WHERE id = ?').get(newBranchId);
    expect(branchRow).toBeDefined();
  });

  test('Does NOT revert if the operation is EDIT', async () => {
    const db = getDb();
    const conversationId = await createConversation();
    const originalBranchId = getActiveBranchId({ conversationId, userId });

    // Simulate edit: send a different user message content
    const persistence = new SimplifiedPersistence(createTestConfig());
    await persistence.initialize({
      conversationId,
      sessionId,
      userId,
      req: createRequestStub(),
      bodyIn: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Edited message', id: 'msg-1' }],
      },
    });

    const newBranchId = persistence.activeBranchId;
    expect(persistence.branchOperationType).toBe('edit');

    // Record empty response
    persistence.recordAssistantFinal();

    // Should NOT revert because it's an EDIT (the user message changed, so we need the branch)
    const currentBranchId = getActiveBranchId({ conversationId, userId });
    expect(currentBranchId).toBe(newBranchId);
    
    const branchRow = db.prepare('SELECT id FROM conversation_branches WHERE id = ?').get(newBranchId);
    expect(branchRow).toBeDefined();
  });
});
