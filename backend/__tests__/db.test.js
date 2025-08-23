// DB helper unit tests for persistence behaviors

import assert from 'node:assert/strict';
import {
  getDb,
  upsertSession,
  createConversation,
  listConversations,
  getMessagesPage,
  retentionSweep,
} from '../src/db/index.js';
import { config } from '../src/env.js';

config.persistence.enabled = true;
config.persistence.dbUrl = 'file::memory:';
const db = getDb();

const sessionId = 'sess1';

beforeEach(() => {
  db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM sessions;');
  upsertSession(sessionId);
});

describe('DB helpers', () => {
  describe('listConversations', () => {
    test('orders by created_at DESC and paginates with next_cursor', async () => {
      createConversation({ id: 'c1', sessionId, title: 'one' });
      await new Promise((r) => setTimeout(r, 10));
      createConversation({ id: 'c2', sessionId, title: 'two' });

      const page1 = listConversations({ sessionId, limit: 1 });
      assert.equal(page1.items.length, 1);
      assert.equal(page1.items[0].id, 'c2');
      assert.ok(page1.next_cursor);

      const page2 = listConversations({
        sessionId,
        cursor: page1.next_cursor,
        limit: 1,
      });
      assert.equal(page2.items.length, 1);
      assert.equal(page2.items[0].id, 'c1');
      assert.equal(page2.next_cursor, null);
    });

    test('applies cursor filter (created_at < cursor) correctly', async () => {
      createConversation({ id: 'c1', sessionId });
      await new Promise((r) => setTimeout(r, 10));
      createConversation({ id: 'c2', sessionId });

      const firstPage = listConversations({ sessionId, limit: 1 });
      const secondPage = listConversations({
        sessionId,
        cursor: firstPage.next_cursor,
        limit: 10,
      });
      assert.equal(secondPage.items.length, 1);
      assert.equal(secondPage.items[0].id, 'c1');
    });
  });

  describe('getMessagesPage', () => {
    test('returns messages after after_seq with ascending seq ordering', () => {
      createConversation({ id: 'conv', sessionId });
      const stmt = db.prepare(
        `INSERT INTO messages (conversation_id, role, content, seq) VALUES (@cid, 'user', @c, @s)`
      );
      stmt.run({ cid: 'conv', c: 'm1', s: 1 });
      stmt.run({ cid: 'conv', c: 'm2', s: 2 });
      stmt.run({ cid: 'conv', c: 'm3', s: 3 });

      const page = getMessagesPage({ conversationId: 'conv', afterSeq: 1, limit: 5 });
      assert.deepEqual(
        page.messages.map((m) => m.seq),
        [2, 3]
      );
    });

    test('sets next_after_seq when page is full, null otherwise', () => {
      createConversation({ id: 'conv', sessionId });
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
      createConversation({ id: 'old', sessionId });
      db.prepare(
        `UPDATE conversations SET created_at=datetime('now', '-2 days') WHERE id='old'`
      ).run();
      const stmt = db.prepare(
        `INSERT INTO messages (conversation_id, role, content, seq) VALUES (@cid, 'user', 'hi', 1)`
      );
      stmt.run({ cid: 'old' });

      createConversation({ id: 'recent', sessionId });
      stmt.run({ cid: 'recent' });

      const result = retentionSweep({ days: 1 });
      assert.equal(result.deleted, 1);

      const remaining = db
        .prepare('SELECT id FROM conversations ORDER BY id')
        .all()
        .map((r) => r.id);
      assert.deepEqual(remaining, ['recent']);
      const msgCount = db
        .prepare('SELECT COUNT(1) as c FROM messages WHERE conversation_id="old"')
        .get().c;
      assert.equal(msgCount, 0);
    });

    test('skips conversations with metadata.pinned=true', () => {
      createConversation({ id: 'pinned', sessionId });
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

