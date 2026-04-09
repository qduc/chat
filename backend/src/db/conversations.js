import { v4 as uuidv4 } from 'uuid';
import { getDb } from './client.js';
import { clampLimit, parseCreatedAtCursor, appendCreatedAtCursor } from './pagination.js';
import { getRootBranchId, initializeConversationRootBranch } from './branches.js';

export function createConversation({
  id,
  sessionId,
  userId = null,
  title,
  provider_id,
  model,
  streamingEnabled = false,
  toolsEnabled = false,
  reasoningEffort = null,
  verbosity = null,
  metadata = {},
  parentConversationId = null,
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO conversations (id, session_id, user_id, title, provider_id, model, metadata, streaming_enabled, tools_enabled, reasoning_effort, verbosity, parent_conversation_id, created_at, updated_at)
       VALUES (@id, @session_id, @user_id, @title, @provider_id, @model, @metadata, @streaming_enabled, @tools_enabled, @reasoning_effort, @verbosity, @parent_conversation_id, @now, @now)`
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
      reasoning_effort: reasoningEffort,
      verbosity,
      parent_conversation_id: parentConversationId || null,
      now,
    });

    initializeConversationRootBranch({ conversationId: id, userId });
  });

  transaction();
}

export function getConversationById({ id, userId }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const query = `SELECT id, title, provider_id, model, metadata, streaming_enabled, tools_enabled, reasoning_effort, verbosity, parent_conversation_id, active_branch_id, created_at FROM conversations
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

export function updateConversationSettings({ id, userId, streamingEnabled, toolsEnabled, reasoningEffort, verbosity }) {
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

  // Exclude linked/comparison conversations (those with parent_conversation_id)
  let sql = `SELECT id, title, provider_id, model, created_at FROM conversations
         WHERE user_id=@userId AND deleted_at IS NULL AND parent_conversation_id IS NULL`;
  const params = { userId, cursorCreatedAt, cursorId, limit: safeLimit + 1 };

  sql = appendCreatedAtCursor(sql, { cursorCreatedAt, cursorId });
  sql += ` ORDER BY datetime(created_at) DESC, id DESC LIMIT @limit`;

  const allItems = db.prepare(sql).all(params);
  const items = allItems.slice(0, safeLimit);
  const last = items[items.length - 1];
  const next_cursor = allItems.length > safeLimit && last ? `${last.created_at}|${last.id}` : null;
  return { items, next_cursor };
}

/**
 * Search conversations by title for a user
 * @param {string} userId - User ID
 * @param {string} search - Search query string
 * @param {number} limit - Max number of results
 * @returns {Array} Array of conversation metadata
 */
export function searchConversations({ userId, search, limit }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  if (!search || !search.trim()) {
    return listConversations({ userId, limit });
  }

  const db = getDb();
  const safeLimit = clampLimit(limit, { fallback: 20, min: 1, max: 100 });
  const searchPattern = `%${search.trim()}%`;

  // Search by title (case-insensitive), exclude linked/comparison conversations
  const sql = `SELECT id, title, provider_id, model, created_at FROM conversations
         WHERE user_id=@userId AND deleted_at IS NULL AND parent_conversation_id IS NULL
         AND title LIKE @searchPattern
         ORDER BY datetime(created_at) DESC, id DESC LIMIT @limit`;

  const items = db.prepare(sql).all({ userId, searchPattern, limit: safeLimit });
  return { items, next_cursor: null };
}

/**
 * Get linked/comparison conversations for a parent conversation
 * @param {string} parentId - Parent conversation ID
 * @param {string} userId - User ID
 * @returns {Array} Array of linked conversation metadata
 */
export function getLinkedConversations({ parentId, userId }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const query = `SELECT id, title, provider_id, model, active_branch_id, created_at, updated_at FROM conversations
         WHERE parent_conversation_id=@parentId AND user_id=@userId AND deleted_at IS NULL
         ORDER BY datetime(created_at) ASC`;

  return db.prepare(query).all({ parentId, userId });
}

export function softDeleteConversation({ id, userId }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const now = new Date().toISOString();

  // Also soft-delete any linked comparison conversations
  db.prepare(
    `UPDATE conversations SET deleted_at=@now, updated_at=@now
     WHERE parent_conversation_id=@id AND user_id=@userId AND deleted_at IS NULL`
  ).run({ id, userId, now });

  // Delete the parent conversation
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

export function forkConversationFromMessage({
  originalConversationId,
  sessionId,
  userId,
  messageSeq,
  title,
  provider_id,
  model
}) {
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

  let originalMetadata = {};
  try {
    originalMetadata = originalConvo.metadata ? JSON.parse(originalConvo.metadata) : {};
  } catch {
    originalMetadata = {};
  }

  const newConversationId = uuidv4();
  createConversation({
    id: newConversationId,
    sessionId: sessionId || originalConvo.session_id,
    userId,
    title: title || originalConvo.title || null,
    provider_id: provider_id || originalConvo.provider_id || null,
    model: model || originalConvo.model || null,
    streamingEnabled: Boolean(originalConvo.streaming_enabled),
    toolsEnabled: Boolean(originalConvo.tools_enabled),
    reasoningEffort: originalConvo.reasoning_effort || null,
    verbosity: originalConvo.verbosity || null,
    metadata: originalMetadata,
  });

  const rootBranchId = getRootBranchId(newConversationId);
  const sourceMessages = db.prepare(`
    SELECT id, parent_message_id, role, status, content, content_json, seq, metadata_json, client_message_id
    FROM messages
    WHERE conversation_id = @originalConversationId
      AND seq <= @messageSeq
    ORDER BY seq ASC, id ASC
  `).all({ originalConversationId, messageSeq });

  const idMap = new Map();
  for (const sourceMessage of sourceMessages) {
    const info = db.prepare(`
      INSERT INTO messages (
        conversation_id,
        branch_id,
        role,
        status,
        content,
        content_json,
        seq,
        parent_message_id,
        metadata_json,
        client_message_id,
        created_at,
        updated_at
      )
      VALUES (
        @conversationId,
        @branchId,
        @role,
        @status,
        @content,
        @contentJson,
        @seq,
        @parentMessageId,
        @metadataJson,
        @clientMessageId,
        @now,
        @now
      )
    `).run({
      conversationId: newConversationId,
      branchId: rootBranchId,
      role: sourceMessage.role,
      status: sourceMessage.status,
      content: sourceMessage.content,
      contentJson: sourceMessage.content_json,
      seq: sourceMessage.seq,
      parentMessageId: sourceMessage.parent_message_id ? idMap.get(sourceMessage.parent_message_id) || null : null,
      metadataJson: sourceMessage.metadata_json,
      clientMessageId: sourceMessage.client_message_id,
      now,
    });
    idMap.set(sourceMessage.id, info.lastInsertRowid);
  }

  const newHeadMessageId = sourceMessages.length > 0
    ? idMap.get(sourceMessages[sourceMessages.length - 1].id) || null
    : null;
  db.prepare(`
    UPDATE conversation_branches
    SET head_message_id = @headMessageId, updated_at = @now
    WHERE id = @branchId
  `).run({
    branchId: rootBranchId,
    headMessageId: newHeadMessageId,
    now,
  });

  return newConversationId;
}
