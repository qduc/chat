import { SimplifiedPersistence } from '../src/lib/simplifiedPersistence.js';
// const SimplifiedPersistence = class {}; // Mock for now
import { config } from '../src/env.js';
import { getDb } from '../src/db/client.js';

const createTestConfig = ({ checkpointOverrides = {} } = {}) => ({
  ...config,
  persistence: {
    ...config.persistence,
    checkpoint: {
      ...config.persistence.checkpoint,
      intervalMs: checkpointOverrides.intervalMs ?? 100,
      minCharacters: checkpointOverrides.minCharacters ?? 50,
      enabled: checkpointOverrides.enabled ?? true,
    },
  },
});

const createRequestStub = () => ({
  header: () => null,
});

async function initPersistence({ checkpointOverrides } = {}) {
  const persistence = new SimplifiedPersistence(createTestConfig({ checkpointOverrides }));
  await persistence.initialize({
    conversationId: null,
    sessionId: 'test-session',
    userId: 'test-user',
    req: createRequestStub(),
    bodyIn: {
      model: 'gpt-4.1-mini',
      messages: [ { role: 'user', content: 'hi there' } ],
    },
  });
  return persistence;
}

describe('Checkpoint persistence', () => {
  test('creates draft message immediately after initialization', async () => {
    const persistence = await initPersistence();
    const db = getDb();
    const draft = db
      .prepare('SELECT role, status, content, seq FROM messages WHERE id = ?')
      .get(persistence.currentMessageId);

    expect(draft).toMatchObject({ role: 'assistant', status: 'draft', content: '' });
    expect(draft.seq).toBe(persistence.assistantSeq);
  });

  test('performs checkpoint when size threshold met', async () => {
    const persistence = await initPersistence({ checkpointOverrides: { minCharacters: 10 } });
    const db = getDb();
    const payload = 'x'.repeat(12);

    persistence.appendContent(payload);

    const updated = db
      .prepare('SELECT content, status FROM messages WHERE id = ?')
      .get(persistence.currentMessageId);

    expect(updated.content).toBe(payload);
    expect(updated.status).toBe('draft');
  });

  test('performs checkpoint when time threshold met', async () => {
    const persistence = await initPersistence({ checkpointOverrides: { intervalMs: 500 } });
    const db = getDb();

    persistence.lastCheckpoint = Date.now() - (persistence.checkpointConfig.intervalMs + 100);
    persistence.appendContent('a');

    const updated = db
      .prepare('SELECT content FROM messages WHERE id = ?')
      .get(persistence.currentMessageId);

    expect(updated.content).toBe('a');
  });

  test('does not checkpoint when thresholds not met', async () => {
    const persistence = await initPersistence({ checkpointOverrides: { minCharacters: 200 } });
    const db = getDb();

    persistence.appendContent('short');

    const updated = db
      .prepare('SELECT content FROM messages WHERE id = ?')
      .get(persistence.currentMessageId);

    expect(updated.content).toBe('');
  });

  test('updates draft to final on successful completion', async () => {
    const persistence = await initPersistence();
    const db = getDb();

    persistence.appendContent('complete text');
    persistence.recordAssistantFinal({ finishReason: 'stop' });

    const updated = db
      .prepare('SELECT status, content, finish_reason FROM messages WHERE id = ?')
      .get(persistence.currentMessageId);

    expect(updated.status).toBe('final');
    expect(updated.content).toBe('complete text');
    expect(updated.finish_reason).toBe('stop');
  });

  test('preserves partial content on disconnect', async () => {
    const persistence = await initPersistence();
    const db = getDb();

    persistence.appendContent('partial');
    persistence.markError();

    const updated = db
      .prepare('SELECT status, content, finish_reason FROM messages WHERE id = ?')
      .get(persistence.currentMessageId);

    expect(updated.status).toBe('error');
    expect(updated.content).toBe('partial');
    expect(updated.finish_reason).toBe('error');
  });

  test('respects checkpoint.enabled=false configuration', async () => {
    const persistence = await initPersistence({ checkpointOverrides: { enabled: false } });
    const db = getDb();

    persistence.appendContent('enough data to checkpoint');

    const updated = db
      .prepare('SELECT content FROM messages WHERE id = ?')
      .get(persistence.currentMessageId);

    expect(updated.content).toBe('');
  });

  test('falls back to INSERT if draft creation fails', async () => {
    const persistence = await initPersistence();
    // Simulate draft creation failure
    persistence.currentMessageId = null;

    persistence.appendContent('fallback content');
    persistence.recordAssistantFinal({ finishReason: 'stop' });

    // Verify it was inserted as a new message (final-only write)
    const db = getDb();
    // We need to find the message by content/seq since we don't have the ID from draft
    const saved = db
      .prepare('SELECT status, content, finish_reason FROM messages WHERE conversation_id = ? AND seq = ?')
      .get(persistence.conversationId, persistence.assistantSeq);

    expect(saved).toBeDefined();
    expect(saved.status).toBe('final');
    expect(saved.content).toBe('fallback content');
    expect(saved.finish_reason).toBe('stop');
  });
});
