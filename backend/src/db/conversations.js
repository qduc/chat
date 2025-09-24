import { v4 as uuidv4 } from 'uuid';
import { getDb } from './client.js';
import { clampLimit, parseCreatedAtCursor, appendCreatedAtCursor } from './pagination.js';

export function createConversation({
  id,
  sessionId,
  title,
  provider_id,
  model,
  streamingEnabled = false,
  toolsEnabled = false,
  qualityLevel = null,
  reasoningEffort = null,
  verbosity = null,
  metadata = {},
}) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO conversations (id, session_id, user_id, title, provider_id, model, metadata, streaming_enabled, tools_enabled, quality_level, reasoning_effort, verbosity, created_at, updated_at)
     VALUES (@id, @session_id, NULL, @title, @provider_id, @model, @metadata, @streaming_enabled, @tools_enabled, @quality_level, @reasoning_effort, @verbosity, @now, @now)`
  ).run({
    id,
    session_id: sessionId,
    title: title || null,
    provider_id: provider_id || null,
    model: model || null,
    metadata: JSON.stringify(metadata || {}),
    streaming_enabled: streamingEnabled ? 1 : 0,
    tools_enabled: toolsEnabled ? 1 : 0,
    quality_level: qualityLevel,
    reasoning_effort: reasoningEffort,
    verbosity,
    now,
  });
}

export function getConversationById({ id, sessionId }) {
  const db = getDb();
  const result = db
    .prepare(
      `SELECT id, title, provider_id, model, metadata, streaming_enabled, tools_enabled, quality_level, reasoning_effort, verbosity, created_at FROM conversations
     WHERE id=@id AND session_id=@session_id AND deleted_at IS NULL`
    )
    .get({ id, session_id: sessionId });

  if (result) {
    result.streaming_enabled = Boolean(result.streaming_enabled);
    result.tools_enabled = Boolean(result.tools_enabled);
    try {
      result.metadata = result.metadata ? JSON.parse(result.metadata) : {};
    } catch (_) {
      result.metadata = {};
    }
  }

  return result;
}

export function updateConversationMetadata({ id, sessionId, patch }) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT metadata FROM conversations WHERE id=@id AND session_id=@session_id AND deleted_at IS NULL`
    )
    .get({ id, session_id: sessionId });
  if (!row) return false;
  let existing = {};
  try {
    existing = row.metadata ? JSON.parse(row.metadata) : {};
  } catch {
    existing = {};
  }
  const merged = { ...existing, ...(patch || {}) };
  const now = new Date().toISOString();
  const res = db
    .prepare(
      `UPDATE conversations SET metadata=@metadata, updated_at=@now WHERE id=@id AND session_id=@session_id`
    )
    .run({ id, session_id: sessionId, metadata: JSON.stringify(merged), now });
  return res.changes > 0;
}

export function updateConversationTitle({ id, sessionId, title, provider_id }) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE conversations SET title=@title, provider_id=@provider_id, updated_at=@now WHERE id=@id AND session_id=@session_id`
  ).run({ id, session_id: sessionId, title, provider_id, now });
}

export function updateConversationProviderId({ id, sessionId, providerId }) {
  const db = getDb();
  const now = new Date().toISOString();
  const info = db.prepare(
    `UPDATE conversations SET provider_id=@provider_id, updated_at=@now WHERE id=@id AND session_id=@session_id`
  ).run({ id, session_id: sessionId, provider_id: providerId, now });
  return info.changes > 0;
}

export function countConversationsBySession(sessionId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(1) as c FROM conversations WHERE session_id=@sessionId AND deleted_at IS NULL`
    )
    .get({ sessionId });
  return row?.c || 0;
}

export function listConversations({ sessionId, cursor, limit }) {
  const db = getDb();
  const safeLimit = clampLimit(limit, { fallback: 20, min: 1, max: 100 });
  const { cursorCreatedAt, cursorId } = parseCreatedAtCursor(cursor);

  let sql = `SELECT id, title, provider_id, model, created_at FROM conversations
             WHERE session_id=@sessionId AND deleted_at IS NULL`;
  sql = appendCreatedAtCursor(sql, { cursorCreatedAt, cursorId });
  sql += ` ORDER BY datetime(created_at) DESC, id DESC LIMIT @limit`;

  const params = {
    sessionId,
    cursorCreatedAt,
    cursorId,
    limit: safeLimit + 1,
  };

  const allItems = db.prepare(sql).all(params);
  const items = allItems.slice(0, safeLimit);
  const last = items[items.length - 1];
  const next_cursor = allItems.length > safeLimit && last ? `${last.created_at}|${last.id}` : null;
  return { items, next_cursor };
}

export function softDeleteConversation({ id, sessionId }) {
  const db = getDb();
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `UPDATE conversations SET deleted_at=@now, updated_at=@now WHERE id=@id AND session_id=@sessionId AND deleted_at IS NULL`
    )
    .run({ id, sessionId, now });
  return info.changes > 0;
}

export function listConversationsIncludingDeleted({
  sessionId,
  cursor,
  limit,
  includeDeleted = false,
}) {
  const db = getDb();
  const safeLimit = clampLimit(limit, { fallback: 20, min: 1, max: 100 });
  const { cursorCreatedAt, cursorId } = parseCreatedAtCursor(cursor);

  let sql = `SELECT id, title, provider_id, model, created_at, deleted_at FROM conversations
             WHERE session_id=@sessionId`;
  if (!includeDeleted) sql += ` AND deleted_at IS NULL`;
  sql = appendCreatedAtCursor(sql, { cursorCreatedAt, cursorId });
  sql += ` ORDER BY datetime(created_at) DESC, id DESC LIMIT @limit`;

  const params = {
    sessionId,
    cursorCreatedAt,
    cursorId,
    limit: safeLimit + 1,
  };

  const allItems = db
    .prepare(sql)
    .all(params)
    .map((r) => ({
      id: r.id,
      title: r.title,
      provider_id: r.provider_id,
      model: r.model,
      created_at: r.created_at,
    }));
  const items = allItems.slice(0, safeLimit);
  const last = items[items.length - 1];
  const next_cursor = allItems.length > safeLimit && last ? `${last.created_at}|${last.id}` : null;
  return { items, next_cursor };
}

export function forkConversationFromMessage({ originalConversationId, sessionId, messageSeq, title, provider_id, model }) {
  const db = getDb();
  const now = new Date().toISOString();

  const newConversationId = uuidv4();
  db.prepare(
    `INSERT INTO conversations (id, session_id, user_id, title, provider_id, model, metadata, created_at, updated_at)
     VALUES (@id, @session_id, NULL, @title, @provider_id, @model, '{}', @now, @now)`
  ).run({
    id: newConversationId,
    session_id: sessionId,
    title: title || null,
    provider_id: provider_id || null,
    model: model || null,
    now,
  });

  db.prepare(
    `INSERT INTO messages (conversation_id, role, status, content, content_json, seq, tokens_in, tokens_out, finish_reason, tool_calls, function_call, created_at, updated_at)
     SELECT @newConversationId, role, status, content, content_json, seq, tokens_in, tokens_out, finish_reason, tool_calls, function_call, @now, @now
     FROM messages
     WHERE conversation_id = @originalConversationId AND seq <= @messageSeq
     ORDER BY seq`
  ).run({ newConversationId, originalConversationId, messageSeq, now });

  return newConversationId;
}
