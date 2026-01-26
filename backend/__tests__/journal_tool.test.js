import { beforeAll, afterAll, beforeEach, describe, expect, test } from '@jest/globals';
import { config } from '../src/env.js';
import { getDb, resetDbCache } from '../src/db/index.js';
import { insertJournalEntry, listJournalEntries } from '../src/db/journal.js';
import { journalTool } from '../src/lib/tools/journal.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import { ensureTestUser, TEST_USER_ID } from './helpers/systemPromptsTestUtils.js';

beforeAll(() => {
  safeTestSetup();
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  getDb();
  ensureTestUser();
});

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM journal').run();
  ensureTestUser();
});

afterAll(() => {
  resetDbCache();
});

describe('journal tool validation', () => {
  test('rejects invalid arguments', () => {
    expect(() => journalTool.validate()).toThrow('journal requires an arguments object');
    expect(() => journalTool.validate({})).toThrow('journal.mode must be either "write" or "read"');
    expect(() => journalTool.validate({ mode: 'read', page: 0 })).toThrow(
      'journal.read page must be an integer >= 1'
    );
  });

  test('normalizes write arguments', () => {
    const result = journalTool.validate({ mode: 'write', name: '  gpt-4.1  ', content: 'note' });
    expect(result).toEqual({ mode: 'write', name: 'gpt-4.1', content: 'note' });
  });

  test('accepts read arguments with default page', () => {
    const result = journalTool.validate({ mode: 'read' });
    expect(result).toEqual({ mode: 'read', page: 1 });
  });
});

describe('journal tool handler', () => {
  test('requires an authenticated user context', async () => {
    await expect(journalTool.handler({ mode: 'read', page: 1 })).rejects.toThrow(
      'journal tool requires an authenticated user context'
    );
  });

  test('writes a journal entry and returns success', async () => {
    const response = await journalTool.handler(
      { mode: 'write', name: 'gpt-4.1-mini', content: 'hello journal' },
      { userId: TEST_USER_ID }
    );

    expect(response).toEqual({ success: true });

    const entries = listJournalEntries(TEST_USER_ID, 1, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      user_id: TEST_USER_ID,
      model_name: 'gpt-4.1-mini',
      content: 'hello journal',
    });
  });

  test('reads entries in descending created_at order', async () => {
    const db = getDb();
    const older = insertJournalEntry({
      userId: TEST_USER_ID,
      modelName: 'gpt-4.1-mini',
      content: 'older entry',
    });

    db.prepare('UPDATE journal SET created_at = @createdAt WHERE id = @id').run({
      createdAt: '2020-01-01T00:00:00.000Z',
      id: older.id,
    });

    insertJournalEntry({
      userId: TEST_USER_ID,
      modelName: 'gpt-4.1-mini',
      content: 'newer entry',
    });

    const response = await journalTool.handler({ mode: 'read', page: 1 }, { userId: TEST_USER_ID });

    expect(response.page).toBe(1);
    expect(response.pageSize).toBe(10);
    expect(response.entries).toHaveLength(2);
    expect(response.entries[0].content).toBe('newer entry');
    expect(response.entries[1].content).toBe('older entry');
  });
});
