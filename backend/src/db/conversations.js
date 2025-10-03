import { v4 as uuidv4 } from 'uuid';
import { getDb } from './client.js';
import { clampLimit, parseCreatedAtCursor, appendCreatedAtCursor } from './pagination.js';

export function createConversation({
  id,
  sessionId,
  userId = null,
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
     VALUES (@id, @session_id, @user_id, @title, @provider_id, @model, @metadata, @streaming_enabled, @tools_enabled, @quality_level, @reasoning_effort, @verbosity, @now, @now)`
  ).run({
    id,
    session_id: sessionId,
    user_id: userId,
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

export function getConversationById({ id, userId }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const query = `SELECT id, title, provider_id, model, metadata, streaming_enabled, tools_enabled, quality_level, reasoning_effort, verbosity, created_at FROM conversations
           WHERE id=@id AND user_id=@user_id AND deleted_at IS NULL`;
  const result = db.prepare(query).get({ id, user_id: userId });

  if (result) {
    result.streaming_enabled = Boolean(result.streaming_enabled);
    result.tools_enabled = Boolean(result.tools_enabled);
    try {
      result.metadata = result.metadata ? JSON.parse(result.metadata) : {};
    } catch {
      result.metadata = {};
    }
    const activeTools = Array.isArray(result.metadata?.active_tools)
      ? result.metadata.active_tools
      : [];
    result.metadata = {
      ...result.metadata,
      active_tools: activeTools,
    };
    result.active_tools = activeTools;
  }

  return result;
}

export function updateConversationMetadata({ id, userId, patch }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const selectQuery = `SELECT metadata FROM conversations WHERE id=@id AND user_id=@userId AND deleted_at IS NULL`;
  const row = db.prepare(selectQuery).get({ id, userId });
  if (!row) return false;

  let existing = {};
  try {
    existing = row.metadata ? JSON.parse(row.metadata) : {};
  } catch {
    existing = {};
  }
  const merged = { ...existing, ...(patch || {}) };
  const now = new Date().toISOString();

  const updateQuery = `UPDATE conversations SET metadata=@metadata, updated_at=@now WHERE id=@id AND user_id=@userId AND deleted_at IS NULL`;
  const res = db.prepare(updateQuery).run({ id, userId, metadata: JSON.stringify(merged), now });
  return res.changes > 0;
}

export function updateConversationTitle({ id, userId, title, provider_id }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const now = new Date().toISOString();
  const query = `UPDATE conversations SET title=@title, provider_id=@provider_id, updated_at=@now WHERE id=@id AND user_id=@userId AND deleted_at IS NULL`;
  db.prepare(query).run({ id, userId, title, provider_id, now });
}

export function updateConversationProviderId({ id, userId, providerId }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const now = new Date().toISOString();
  const query = `UPDATE conversations SET provider_id=@provider_id, updated_at=@now WHERE id=@id AND user_id=@userId AND deleted_at IS NULL`;
  const info = db.prepare(query).run({ id, userId, provider_id: providerId, now });
  return info.changes > 0;
}

export function updateConversationModel({ id, userId, model }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const now = new Date().toISOString();
  const query = `UPDATE conversations SET model=@model, updated_at=@now WHERE id=@id AND user_id=@userId AND deleted_at IS NULL`;
  const info = db.prepare(query).run({ id, userId, model, now });
  return info.changes > 0;
}

export function updateConversationSettings({ id, userId, streamingEnabled, toolsEnabled, qualityLevel, reasoningEffort, verbosity }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const now = new Date().toISOString();

  // Build update fields dynamically based on what's provided
  const updates = [];
  const paramData = { id, userId, now };

  if (streamingEnabled !== undefined) {
    updates.push('streaming_enabled=@streaming_enabled');
    paramData.streaming_enabled = streamingEnabled ? 1 : 0;
  }
  if (toolsEnabled !== undefined) {
    updates.push('tools_enabled=@tools_enabled');
    paramData.tools_enabled = toolsEnabled ? 1 : 0;
  }
  if (qualityLevel !== undefined) {
    updates.push('quality_level=@quality_level');
    paramData.quality_level = qualityLevel;
  }
  if (reasoningEffort !== undefined) {
    updates.push('reasoning_effort=@reasoning_effort');
    paramData.reasoning_effort = reasoningEffort;
  }
  if (verbosity !== undefined) {
    updates.push('verbosity=@verbosity');
    paramData.verbosity = verbosity;
  }

  // If nothing to update, return early
  if (updates.length === 0) return false;

  updates.push('updated_at=@now');

  const query = `UPDATE conversations SET ${updates.join(', ')} WHERE id=@id AND user_id=@userId AND deleted_at IS NULL`;
  const info = db.prepare(query).run(paramData);
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

export function listConversations({ userId, cursor, limit }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const safeLimit = clampLimit(limit, { fallback: 20, min: 1, max: 100 });
  const { cursorCreatedAt, cursorId } = parseCreatedAtCursor(cursor);

  let sql = `SELECT id, title, provider_id, model, created_at FROM conversations
         WHERE user_id=@userId AND deleted_at IS NULL`;
  const params = { userId, cursorCreatedAt, cursorId, limit: safeLimit + 1 };

  sql = appendCreatedAtCursor(sql, { cursorCreatedAt, cursorId });
  sql += ` ORDER BY datetime(created_at) DESC, id DESC LIMIT @limit`;

  const allItems = db.prepare(sql).all(params);
  const items = allItems.slice(0, safeLimit);
  const last = items[items.length - 1];
  const next_cursor = allItems.length > safeLimit && last ? `${last.created_at}|${last.id}` : null;
  return { items, next_cursor };
}

export function softDeleteConversation({ id, userId }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const now = new Date().toISOString();
  const query = `UPDATE conversations SET deleted_at=@now, updated_at=@now WHERE id=@id AND user_id=@userId AND deleted_at IS NULL`;
  const info = db.prepare(query).run({ id, userId, now });
  return info.changes > 0;
}

export function listConversationsIncludingDeleted({
  userId,
  cursor,
  limit,
  includeDeleted = false,
}) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const safeLimit = clampLimit(limit, { fallback: 20, min: 1, max: 100 });
  const { cursorCreatedAt, cursorId } = parseCreatedAtCursor(cursor);

  let sql = `SELECT id, title, provider_id, model, created_at, deleted_at FROM conversations
         WHERE user_id=@userId`;
  const params = { userId, cursorCreatedAt, cursorId, limit: safeLimit + 1 };

  if (!includeDeleted) sql += ` AND deleted_at IS NULL`;
  sql = appendCreatedAtCursor(sql, { cursorCreatedAt, cursorId });
  sql += ` ORDER BY datetime(created_at) DESC, id DESC LIMIT @limit`;

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

export function forkConversationFromMessage({ originalConversationId, sessionId, userId, messageSeq, title, provider_id, model }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const now = new Date().toISOString();

  // Get the original conversation to copy all metadata
  const originalConvo = db.prepare(
    `SELECT * FROM conversations WHERE id = @id AND deleted_at IS NULL`
  ).get({ id: originalConversationId });

  if (!originalConvo) {
    throw new Error('Original conversation not found');
  }

  const newConversationId = uuidv4();
  db.prepare(
    `INSERT INTO conversations (id, session_id, user_id, title, provider_id, model, metadata, streaming_enabled, tools_enabled, quality_level, reasoning_effort, verbosity, created_at, updated_at)
     VALUES (@id, @session_id, @user_id, @title, @provider_id, @model, @metadata, @streaming_enabled, @tools_enabled, @quality_level, @reasoning_effort, @verbosity, @now, @now)`
  ).run({
    id: newConversationId,
    session_id: sessionId,
    user_id: userId,
    title: title || null,
    provider_id: provider_id || null,
    model: model || null,
    metadata: originalConvo.metadata || '{}',
    streaming_enabled: originalConvo.streaming_enabled || 0,
    tools_enabled: originalConvo.tools_enabled || 0,
    quality_level: originalConvo.quality_level || null,
    reasoning_effort: originalConvo.reasoning_effort || null,
    verbosity: originalConvo.verbosity || null,
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
