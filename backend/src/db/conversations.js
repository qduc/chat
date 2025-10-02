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

export function getConversationById({ id, sessionId, userId = null }) {
  const db = getDb();

  // Prioritize user-based access - authenticated users get their conversations
  let query, params;
  if (userId) {
    query = `SELECT id, title, provider_id, model, metadata, streaming_enabled, tools_enabled, quality_level, reasoning_effort, verbosity, created_at FROM conversations
             WHERE id=@id AND user_id=@user_id AND deleted_at IS NULL`;
    params = { id, user_id: userId };
  } else if (sessionId) {
    // Fallback to session-based access for anonymous users
    query = `SELECT id, title, provider_id, model, metadata, streaming_enabled, tools_enabled, quality_level, reasoning_effort, verbosity, created_at FROM conversations
             WHERE id=@id AND session_id=@session_id AND user_id IS NULL AND deleted_at IS NULL`;
    params = { id, session_id: sessionId };
  } else {
    // No valid identifier
    return null;
  }

  const result = db.prepare(query).get(params);

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

export function updateConversationMetadata({ id, sessionId, userId = null, patch }) {
  const db = getDb();

  let selectQuery, selectParams, updateQuery, updateParams;

  // Prioritize user-based access - authenticated users get their conversations
  if (userId) {
    selectQuery = `SELECT metadata FROM conversations WHERE id=@id AND user_id=@userId AND deleted_at IS NULL`;
    selectParams = { id, userId };
    updateQuery = `UPDATE conversations SET metadata=@metadata, updated_at=@now WHERE id=@id AND user_id=@userId AND deleted_at IS NULL`;
  } else if (sessionId) {
    // Fallback to session-based access for anonymous users
    selectQuery = `SELECT metadata FROM conversations WHERE id=@id AND session_id=@sessionId AND user_id IS NULL AND deleted_at IS NULL`;
    selectParams = { id, sessionId };
    updateQuery = `UPDATE conversations SET metadata=@metadata, updated_at=@now WHERE id=@id AND session_id=@sessionId AND user_id IS NULL AND deleted_at IS NULL`;
  } else {
    return false;
  }

  const row = db.prepare(selectQuery).get(selectParams);
  if (!row) return false;

  let existing = {};
  try {
    existing = row.metadata ? JSON.parse(row.metadata) : {};
  } catch {
    existing = {};
  }
  const merged = { ...existing, ...(patch || {}) };
  const now = new Date().toISOString();

  if (userId) {
    updateParams = { id, userId, metadata: JSON.stringify(merged), now };
  } else {
    updateParams = { id, sessionId, metadata: JSON.stringify(merged), now };
  }

  const res = db.prepare(updateQuery).run(updateParams);
  return res.changes > 0;
}

export function updateConversationTitle({ id, sessionId, userId = null, title, provider_id }) {
  const db = getDb();
  const now = new Date().toISOString();

  let query, params;

  // Prioritize user-based access - authenticated users get their conversations
  if (userId) {
    query = `UPDATE conversations SET title=@title, provider_id=@provider_id, updated_at=@now WHERE id=@id AND user_id=@userId AND deleted_at IS NULL`;
    params = { id, userId, title, provider_id, now };
  } else if (sessionId) {
    // Fallback to session-based access for anonymous users
    query = `UPDATE conversations SET title=@title, provider_id=@provider_id, updated_at=@now WHERE id=@id AND session_id=@sessionId AND user_id IS NULL AND deleted_at IS NULL`;
    params = { id, sessionId, title, provider_id, now };
  } else {
    return;
  }

  db.prepare(query).run(params);
}

export function updateConversationProviderId({ id, sessionId, userId = null, providerId }) {
  const db = getDb();
  const now = new Date().toISOString();

  let query, params;

  // Prioritize user-based access - authenticated users get their conversations
  if (userId) {
    query = `UPDATE conversations SET provider_id=@provider_id, updated_at=@now WHERE id=@id AND user_id=@userId AND deleted_at IS NULL`;
    params = { id, userId, provider_id: providerId, now };
  } else if (sessionId) {
    // Fallback to session-based access for anonymous users
    query = `UPDATE conversations SET provider_id=@provider_id, updated_at=@now WHERE id=@id AND session_id=@sessionId AND user_id IS NULL AND deleted_at IS NULL`;
    params = { id, sessionId, provider_id: providerId, now };
  } else {
    return false;
  }

  const info = db.prepare(query).run(params);
  return info.changes > 0;
}

export function updateConversationModel({ id, sessionId, userId = null, model }) {
  const db = getDb();
  const now = new Date().toISOString();

  let query, params;

  // Prioritize user-based access - authenticated users get their conversations
  if (userId) {
    query = `UPDATE conversations SET model=@model, updated_at=@now WHERE id=@id AND user_id=@userId AND deleted_at IS NULL`;
    params = { id, userId, model, now };
  } else if (sessionId) {
    // Fallback to session-based access for anonymous users
    query = `UPDATE conversations SET model=@model, updated_at=@now WHERE id=@id AND session_id=@sessionId AND user_id IS NULL AND deleted_at IS NULL`;
    params = { id, sessionId, model, now };
  } else {
    return false;
  }

  const info = db.prepare(query).run(params);
  return info.changes > 0;
}

export function updateConversationSettings({ id, sessionId, userId = null, streamingEnabled, toolsEnabled, qualityLevel, reasoningEffort, verbosity }) {
  const db = getDb();
  const now = new Date().toISOString();

  let query;

  // Build update fields dynamically based on what's provided
  const updates = [];
  const paramData = { id, now };

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

  // Prioritize user-based access - authenticated users get their conversations
  if (userId) {
    query = `UPDATE conversations SET ${updates.join(', ')} WHERE id=@id AND user_id=@userId AND deleted_at IS NULL`;
    paramData.userId = userId;
  } else if (sessionId) {
    // Fallback to session-based access for anonymous users
    query = `UPDATE conversations SET ${updates.join(', ')} WHERE id=@id AND session_id=@sessionId AND user_id IS NULL AND deleted_at IS NULL`;
    paramData.sessionId = sessionId;
  } else {
    return false;
  }

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

export function listConversations({ sessionId, userId = null, cursor, limit }) {
  const db = getDb();
  const safeLimit = clampLimit(limit, { fallback: 20, min: 1, max: 100 });
  const { cursorCreatedAt, cursorId } = parseCreatedAtCursor(cursor);

  let sql, params;

  // Prioritize user-based access - authenticated users get their conversations
  if (userId) {
    sql = `SELECT id, title, provider_id, model, created_at FROM conversations
           WHERE user_id=@userId AND deleted_at IS NULL`;
    params = { userId, cursorCreatedAt, cursorId, limit: safeLimit + 1 };
  } else if (sessionId) {
    // Fallback to session-based access for anonymous users
    sql = `SELECT id, title, provider_id, model, created_at FROM conversations
           WHERE session_id=@sessionId AND user_id IS NULL AND deleted_at IS NULL`;
    params = { sessionId, cursorCreatedAt, cursorId, limit: safeLimit + 1 };
  } else {
    // No valid identifier
    return { items: [], next_cursor: null };
  }

  sql = appendCreatedAtCursor(sql, { cursorCreatedAt, cursorId });
  sql += ` ORDER BY datetime(created_at) DESC, id DESC LIMIT @limit`;

  const allItems = db.prepare(sql).all(params);
  const items = allItems.slice(0, safeLimit);
  const last = items[items.length - 1];
  const next_cursor = allItems.length > safeLimit && last ? `${last.created_at}|${last.id}` : null;
  return { items, next_cursor };
}

export function softDeleteConversation({ id, sessionId, userId = null }) {
  const db = getDb();
  const now = new Date().toISOString();

  let query, params;

  // Prioritize user-based access - authenticated users get their conversations
  if (userId) {
    query = `UPDATE conversations SET deleted_at=@now, updated_at=@now WHERE id=@id AND user_id=@userId AND deleted_at IS NULL`;
    params = { id, userId, now };
  } else if (sessionId) {
    // Fallback to session-based access for anonymous users
    query = `UPDATE conversations SET deleted_at=@now, updated_at=@now WHERE id=@id AND session_id=@sessionId AND user_id IS NULL AND deleted_at IS NULL`;
    params = { id, sessionId, now };
  } else {
    return false;
  }

  const info = db.prepare(query).run(params);
  return info.changes > 0;
}

export function listConversationsIncludingDeleted({
  sessionId,
  userId = null,
  cursor,
  limit,
  includeDeleted = false,
}) {
  const db = getDb();
  const safeLimit = clampLimit(limit, { fallback: 20, min: 1, max: 100 });
  const { cursorCreatedAt, cursorId } = parseCreatedAtCursor(cursor);

  let sql, params;

  // Prioritize user-based access - authenticated users get their conversations
  if (userId) {
    sql = `SELECT id, title, provider_id, model, created_at, deleted_at FROM conversations
           WHERE user_id=@userId`;
    params = { userId, cursorCreatedAt, cursorId, limit: safeLimit + 1 };
  } else if (sessionId) {
    // Fallback to session-based access for anonymous users
    sql = `SELECT id, title, provider_id, model, created_at, deleted_at FROM conversations
           WHERE session_id=@sessionId AND user_id IS NULL`;
    params = { sessionId, cursorCreatedAt, cursorId, limit: safeLimit + 1 };
  } else {
    // No valid identifier
    return { items: [], next_cursor: null };
  }

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

export function forkConversationFromMessage({ originalConversationId, sessionId, userId = null, messageSeq, title, provider_id, model }) {
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
