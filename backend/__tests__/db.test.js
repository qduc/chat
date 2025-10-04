// DB helper unit tests for persistence behaviors

import assert from 'node:assert/strict';
import {
  getDb,
  upsertSession,
  createConversation,
  listConversations,
  getMessagesPage,
  retentionSweep,
  resetDbCache,
} from '../src/db/index.js';
import { createUser } from '../src/db/users.js';
import { config } from '../src/env.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';

const sessionId = 'sess1';
let testUser;

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

  // Create a test user for conversations (Phase 3: all conversations need userId)
  testUser = createUser({
    email: 'test@example.com',
    passwordHash: 'test-hash',
    displayName: 'Test User'
  });

  upsertSession(sessionId, { userId: testUser.id });
});

afterAll(() => {
  // Properly close database connections to prevent process leaks
  resetDbCache();
});

describe('DB helpers', () => {
  describe('listConversations', () => {
    test('orders by created_at DESC and paginates with next_cursor', () => {
      // Create conversations with deterministic timestamps by manipulating created_at directly
      createConversation({ id: 'c1', sessionId, userId: testUser.id, title: 'one' });
      createConversation({ id: 'c2', sessionId, userId: testUser.id, title: 'two' });

      // Set explicit timestamps to ensure deterministic ordering (c2 newer than c1)
      const db = getDb();
      db.prepare(`UPDATE conversations SET created_at = datetime('now', '-1 hour') WHERE id = 'c1'`).run();
      db.prepare(`UPDATE conversations SET created_at = datetime('now') WHERE id = 'c2'`).run();

      // Test behavior: newest conversation appears first
      const page1 = listConversations({ userId: testUser.id, limit: 1 });
      assert.equal(page1.items.length, 1);
      assert.equal(page1.items[0].id, 'c2');
      assert.ok(page1.next_cursor);

      // Test behavior: pagination continues with older conversation
      const page2 = listConversations({
        userId: testUser.id,
        cursor: page1.next_cursor,
        limit: 1,
      });
      assert.equal(page2.items.length, 1);
      assert.equal(page2.items[0].id, 'c1');
      assert.equal(page2.next_cursor, null);
    });

    test('applies cursor filter (created_at < cursor) correctly', () => {
      // Create conversations with deterministic timestamps
      createConversation({ id: 'c1', sessionId, userId: testUser.id });
      createConversation({ id: 'c2', sessionId, userId: testUser.id });

      // Set explicit timestamps to ensure deterministic ordering
      const db = getDb();
      db.prepare(`UPDATE conversations SET created_at = datetime('now', '-1 hour') WHERE id = 'c1'`).run();
      db.prepare(`UPDATE conversations SET created_at = datetime('now') WHERE id = 'c2'`).run();

      // Test behavior: cursor pagination filters correctly
      const firstPage = listConversations({ userId: testUser.id, limit: 1 });
      const secondPage = listConversations({
        userId: testUser.id,
        cursor: firstPage.next_cursor,
        limit: 10,
      });
      assert.equal(secondPage.items.length, 1);
      assert.equal(secondPage.items[0].id, 'c1');
    });
  });

  describe('getMessagesPage', () => {
    test('returns messages after after_seq with ascending seq ordering', () => {
      createConversation({ id: 'conv', sessionId, userId: testUser.id });
      const db = getDb();
      const stmt = db.prepare(
        `INSERT INTO messages (conversation_id, role, content, seq) VALUES (@cid, 'user', @c, @s)`
      );
      stmt.run({ cid: 'conv', c: 'm1', s: 1 });
      stmt.run({ cid: 'conv', c: 'm2', s: 2 });
      stmt.run({ cid: 'conv', c: 'm3', s: 3 });

      const page = getMessagesPage({ conversationId: 'conv', afterSeq: 1, limit: 5 });
      const seqs = page.messages.map((m) => m.seq);
      assert.equal(seqs.length, 2);
      assert.equal(seqs[0], 2);
      assert.equal(seqs[1], 3);
    });

    test('sets next_after_seq when page is full, null otherwise', () => {
      createConversation({ id: 'conv', sessionId, userId: testUser.id });
      const db = getDb();
      const stmt = db.prepare(
        `INSERT INTO messages (conversation_id, role, content, seq) VALUES (@cid, 'user', @c, @s)`
      );
      stmt.run({ cid: 'conv', c: 'm1', s: 1 });
      stmt.run({ cid: 'conv', c: 'm2', s: 2 });
      stmt.run({ cid: 'conv', c: 'm3', s: 3 });

      const full = getMessagesPage({ conversationId: 'conv', afterSeq: 0, limit: 2 });
      assert.equal(full.next_after_seq, 2);

      const partial = getMessagesPage({ conversationId: 'conv', afterSeq: 2, limit: 5 });
      assert.equal(partial.next_after_seq, null);
    });
  });

  describe('retentionSweep', () => {
    test('deletes conversations older than cutoff (including messages)', () => {
      createConversation({ id: 'old', sessionId, userId: testUser.id });
      const db = getDb();
      db.prepare(
        `UPDATE conversations SET created_at=datetime('now', '-2 days') WHERE id='old'`
      ).run();
      const stmt = db.prepare(
        `INSERT INTO messages (conversation_id, role, content, seq) VALUES (@cid, 'user', 'hi', 1)`
      );
      stmt.run({ cid: 'old' });

      createConversation({ id: 'recent', sessionId, userId: testUser.id });
      stmt.run({ cid: 'recent' });

      const result = retentionSweep({ days: 1 });
      assert.equal(result.deleted, 1);

      const remaining = db
        .prepare('SELECT id FROM conversations ORDER BY id')
        .all()
        .map((r) => r.id);
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0], 'recent');
      const msgCount = db
        .prepare("SELECT COUNT(1) as c FROM messages WHERE conversation_id='old'")
        .get().c;
      assert.equal(msgCount, 0);
    });

    test('skips conversations with metadata.pinned=true', () => {
      createConversation({ id: 'pinned', sessionId, userId: testUser.id });
      const db = getDb();
      db.prepare(
        `UPDATE conversations SET created_at=datetime('now', '-2 days'), metadata='{"pinned":1}' WHERE id='pinned'`
      ).run();

      const result = retentionSweep({ days: 1 });
      assert.equal(result.deleted, 0);
      const row = db
        .prepare("SELECT COUNT(1) as c FROM conversations WHERE id='pinned'")
        .get();
      assert.equal(row.c, 1);
    });
  });
});
