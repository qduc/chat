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

  test('Keeps branch when partial content was streamed before error', async () => {
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
    expect(newBranchId).not.toBe(originalBranchId);

    // Provider actually streamed something before failing — this is a partial
    // response, not a pure error, so the branch must be kept.
    persistence.appendContent('Here is the start of my answer');
    persistence.markError('[Error: Provider rate limit exceeded]');

    expect(getActiveBranchId({ conversationId, userId })).toBe(newBranchId);

    const branchRow = db
      .prepare('SELECT id FROM conversation_branches WHERE id = ?')
      .get(newBranchId);
    expect(branchRow).toBeDefined();

    const messageRow = db
      .prepare('SELECT status, content FROM messages WHERE branch_id = ? AND role = ? ORDER BY seq DESC LIMIT 1')
      .get(newBranchId, 'assistant');
    expect(messageRow.status).toBe('error');
    expect(messageRow.content).toContain('Here is the start of my answer');
    expect(messageRow.content).toContain('[Error: Provider rate limit exceeded]');
  });

  test('Reverts branch when only the error framing text was produced (pure error with message)', async () => {
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
    expect(newBranchId).not.toBe(originalBranchId);

    // Provider failed without streaming anything; only the error framing string
    // is passed to markError. This is a pure error and must revert.
    persistence.markError('[Error: Provider rate limit exceeded]');

    expect(getActiveBranchId({ conversationId, userId })).toBe(originalBranchId);
    expect(
      db.prepare('SELECT id FROM conversation_branches WHERE id = ?').get(newBranchId)
    ).toBeUndefined();
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

  describe('Retry of errored assistant turn - overwrite, no branching', () => {
    test('Retry after partial-content error → reuse errored message and overwrite', async () => {
      const db = getDb();
      const conversationId = await createConversation();
      const originalBranchId = getActiveBranchId({ conversationId, userId });

      // Step 1: regenerate, stream partial content, then error
      const persistence1 = new SimplifiedPersistence(createTestConfig());
      await persistence1.initialize({
        conversationId,
        sessionId,
        userId,
        req: createRequestStub(),
        bodyIn: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'First message', id: 'msg-1' }],
        },
      });

      const newBranchId = persistence1.activeBranchId;
      expect(persistence1.branchOperationType).toBe('regenerate');
      expect(newBranchId).not.toBe(originalBranchId);

      const erroredMessageId = persistence1.currentMessageId;
      expect(erroredMessageId).toBeTruthy();

      persistence1.appendContent('Partial response before error');
      persistence1.markError('...error occurred');

      // Branch kept because there was partial content (not pure error)
      expect(getActiveBranchId({ conversationId, userId })).toBe(newBranchId);

      const errorMsg = db
        .prepare('SELECT id, status FROM messages WHERE id = ?')
        .get(erroredMessageId);
      expect(errorMsg).toBeDefined();
      expect(errorMsg.status).toBe('error');

      // Step 2: retry — reuse the errored message in place, no new branch
      const persistence2 = new SimplifiedPersistence(createTestConfig());
      await persistence2.initialize({
        conversationId,
        sessionId,
        userId,
        req: createRequestStub(),
        bodyIn: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'First message', id: 'msg-1' }],
        },
        retryOfErroredAssistant: true,
      });

      expect(persistence2.retryOfErroredAssistant).toBe(true);
      expect(persistence2.isNewBranchCreated).toBe(false);
      expect(persistence2.currentMessageId).toBe(erroredMessageId);

      persistence2.appendContent('New successful response after retry');
      persistence2.recordAssistantFinal();

      const messageRow = db
        .prepare('SELECT id, status, content FROM messages WHERE id = ?')
        .get(erroredMessageId);
      expect(messageRow).toMatchObject({
        id: erroredMessageId,
        status: 'final',
        content: 'New successful response after retry',
      });
    });

    test('Retry after pure error (branch was deleted) → falls back to normal regenerate', async () => {
      const db = getDb();
      const conversationId = await createConversation();
      const originalBranchId = getActiveBranchId({ conversationId, userId });

      // Step 1: pure error — branch reverted+deleted, no errored row left in DB
      const persistence1 = new SimplifiedPersistence(createTestConfig());
      await persistence1.initialize({
        conversationId,
        sessionId,
        userId,
        req: createRequestStub(),
        bodyIn: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'First message', id: 'msg-1' }],
        },
      });

      const deletedBranchId = persistence1.activeBranchId;
      persistence1.markError();

      expect(getActiveBranchId({ conversationId, userId })).toBe(originalBranchId);
      expect(
        db.prepare('SELECT id FROM conversation_branches WHERE id = ?').get(deletedBranchId)
      ).toBeUndefined();

      // No errored assistant message remains in the DB
      const erroredCount = db
        .prepare(
          "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND role='assistant' AND status='error'"
        )
        .get(conversationId);
      expect(erroredCount.n).toBe(0);

      // Step 2: proxy would NOT flag this as retry (no errored message), so
      // `retryOfErroredAssistant` stays false. Normal regenerate path applies.
      const persistence2 = new SimplifiedPersistence(createTestConfig());
      await persistence2.initialize({
        conversationId,
        sessionId,
        userId,
        req: createRequestStub(),
        bodyIn: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'First message', id: 'msg-1' }],
        },
      });

      expect(persistence2.retryOfErroredAssistant).toBe(false);
      expect(persistence2.branchOperationType).toBe('regenerate');
      expect(persistence2.activeBranchId).not.toBe(originalBranchId);

      persistence2.appendContent('Successful retry content');
      persistence2.recordAssistantFinal();

      const messageRow = db
        .prepare(
          "SELECT content, status FROM messages WHERE id = ?"
        )
        .get(persistence2.currentMessageId);
      expect(messageRow).toMatchObject({
        status: 'final',
        content: 'Successful retry content',
      });
    });

    test('Two consecutive pure errors → branches stay reverted, no accumulation', async () => {
      const db = getDb();
      const conversationId = await createConversation();
      const originalBranchId = getActiveBranchId({ conversationId, userId });

      // First pure error
      const p1 = new SimplifiedPersistence(createTestConfig());
      await p1.initialize({
        conversationId,
        sessionId,
        userId,
        req: createRequestStub(),
        bodyIn: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'First message', id: 'msg-1' }],
        },
      });
      const firstNewBranch = p1.activeBranchId;
      p1.markError();

      expect(getActiveBranchId({ conversationId, userId })).toBe(originalBranchId);
      expect(
        db.prepare('SELECT id FROM conversation_branches WHERE id = ?').get(firstNewBranch)
      ).toBeUndefined();

      // Second attempt — also pure error
      const p2 = new SimplifiedPersistence(createTestConfig());
      await p2.initialize({
        conversationId,
        sessionId,
        userId,
        req: createRequestStub(),
        bodyIn: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'First message', id: 'msg-1' }],
        },
      });
      const secondNewBranch = p2.activeBranchId;
      p2.markError();

      // Second attempt's branch also gone; active still original.
      expect(getActiveBranchId({ conversationId, userId })).toBe(originalBranchId);
      expect(
        db.prepare('SELECT id FROM conversation_branches WHERE id = ?').get(secondNewBranch)
      ).toBeUndefined();

      // No errored rows accumulated
      const errored = db
        .prepare(
          "SELECT COUNT(*) AS n FROM messages WHERE conversation_id=? AND role='assistant' AND status='error'"
        )
        .get(conversationId);
      expect(errored.n).toBe(0);
    });
  });
});

