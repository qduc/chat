// Unit tests for system prompt name deduplication
import assert from 'node:assert/strict';
import { config } from '../src/env.js';
import { getDb, resetDbCache } from '../src/db/index.js';
import {
  ensureTestUser,
  TEST_USER_ID,
} from './helpers/systemPromptsTestUtils.js';
import {
  createCustomPrompt,
  updateCustomPrompt,
} from '../src/db/systemPrompts.js';

// Configure in-memory DB for deterministic suffix behaviour
beforeAll(() => {
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  getDb();
  ensureTestUser();
});

afterAll(() => {
  resetDbCache();
});

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM system_prompts').run();
});

describe('System prompt name uniqueness', () => {
  test('creates unique names by appending numeric suffixes', () => {
    const first = createCustomPrompt({ name: 'Daily Brief', body: 'Focus on key updates.' }, TEST_USER_ID);
    const second = createCustomPrompt({ name: 'Daily Brief', body: 'Duplicate name attempt.' }, TEST_USER_ID);
    const third = createCustomPrompt({ name: 'Daily Brief', body: 'Another duplicate.' }, TEST_USER_ID);

    assert.equal(first.name, 'Daily Brief');
    assert.equal(second.name, 'Daily Brief (1)');
    assert.equal(third.name, 'Daily Brief (2)');
  });

  test('deduplicates names case-insensitively and trims whitespace', () => {
    const base = createCustomPrompt({ name: 'Focus Mode', body: 'Stay concise.' }, TEST_USER_ID);
    const duplicate = createCustomPrompt({ name: '  focus mode  ', body: 'Whitespace + casing.' }, TEST_USER_ID);

    assert.equal(base.name, 'Focus Mode');
    assert.equal(duplicate.name, 'focus mode (1)');
  });

  test('update excludes the current prompt while checking for conflicts', () => {
    const original = createCustomPrompt({ name: 'Research', body: 'Original content.' }, TEST_USER_ID);
    const other = createCustomPrompt({ name: 'Experiment', body: 'Other prompt.' }, TEST_USER_ID);

    const updated = updateCustomPrompt(other.id, { name: 'research' }, TEST_USER_ID);

    assert.ok(updated);
    assert.equal(updated.name, 'research (1)');

    const sameNameUpdate = updateCustomPrompt(original.id, { name: 'Research' }, TEST_USER_ID);
    assert.ok(sameNameUpdate);
    assert.equal(sameNameUpdate.name, 'Research');
  });
});
