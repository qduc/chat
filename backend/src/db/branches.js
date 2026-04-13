import { v4 as uuidv4 } from 'uuid';
import { getDb } from './client.js';

export function getRootBranchId(conversationId) {
  return `${conversationId}:root`;
}

export function createConversationBranch({
  id = uuidv4(),
  conversationId,
  userId,
  parentBranchId = null,
  branchPointMessageId = null,
  sourceMessageId = null,
  operationType = 'fork',
  label = null,
  headMessageId = null,
}) {
  if (!conversationId) throw new Error('conversationId is required');
  if (!userId) throw new Error('userId is required');

  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO conversation_branches (
      id,
      conversation_id,
      user_id,
      parent_branch_id,
      branch_point_message_id,
      source_message_id,
      operation_type,
      label,
      head_message_id,
      created_at,
      updated_at,
      archived_at
    )
    VALUES (
      @id,
      @conversationId,
      @userId,
      @parentBranchId,
      @branchPointMessageId,
      @sourceMessageId,
      @operationType,
      @label,
      @headMessageId,
      @now,
      @now,
      NULL
    )
  `).run({
    id,
    conversationId,
    userId,
    parentBranchId,
    branchPointMessageId,
    sourceMessageId,
    operationType,
    label,
    headMessageId,
    now,
  });

  return id;
}

export function initializeConversationRootBranch({ conversationId, userId }) {
  const branchId = getRootBranchId(conversationId);
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT OR IGNORE INTO conversation_branches (
      id,
      conversation_id,
      user_id,
      parent_branch_id,
      branch_point_message_id,
      source_message_id,
      operation_type,
      label,
      head_message_id,
      created_at,
      updated_at,
      archived_at
    )
    VALUES (
      @branchId,
      @conversationId,
      @userId,
      NULL,
      NULL,
      NULL,
      'root',
      'Main',
      NULL,
      @now,
      @now,
      NULL
    )
  `).run({
    branchId,
    conversationId,
    userId,
    now,
  });

  db.prepare(`
    UPDATE conversations
    SET active_branch_id = COALESCE(active_branch_id, @branchId), updated_at = @now
    WHERE id = @conversationId
  `).run({
    branchId,
    conversationId,
    now,
  });

  return branchId;
}

export function getConversationBranch({ conversationId, branchId, userId }) {
  if (!conversationId) throw new Error('conversationId is required');
  if (!branchId) throw new Error('branchId is required');
  if (!userId) throw new Error('userId is required');

  const db = getDb();
  return db.prepare(`
    SELECT b.*
    FROM conversation_branches b
    JOIN conversations c ON c.id = b.conversation_id
    WHERE b.id = @branchId
      AND b.conversation_id = @conversationId
      AND b.archived_at IS NULL
      AND c.user_id = @userId
      AND c.deleted_at IS NULL
  `).get({ conversationId, branchId, userId });
}

export function getConversationBranches({ conversationId, userId }) {
  if (!conversationId) throw new Error('conversationId is required');
  if (!userId) throw new Error('userId is required');

  const db = getDb();
  return db.prepare(`
    SELECT
      b.id,
      b.conversation_id,
      b.parent_branch_id,
      b.branch_point_message_id,
      b.source_message_id,
      b.operation_type,
      b.label,
      b.head_message_id,
      b.created_at,
      b.updated_at,
      b.archived_at,
      CASE WHEN c.active_branch_id = b.id THEN 1 ELSE 0 END AS is_active
    FROM conversation_branches b
    JOIN conversations c ON c.id = b.conversation_id
    WHERE b.conversation_id = @conversationId
      AND b.archived_at IS NULL
      AND c.user_id = @userId
      AND c.deleted_at IS NULL
    ORDER BY datetime(b.created_at) ASC, b.id ASC
  `).all({ conversationId, userId }).map((row) => ({
    ...row,
    is_active: Boolean(row.is_active),
  }));
}

export function getActiveBranchId({ conversationId, userId }) {
  if (!conversationId) throw new Error('conversationId is required');
  if (!userId) throw new Error('userId is required');

  const db = getDb();
  const row = db.prepare(`
    SELECT active_branch_id
    FROM conversations
    WHERE id = @conversationId
      AND user_id = @userId
      AND deleted_at IS NULL
  `).get({ conversationId, userId });

  return row?.active_branch_id || null;
}

export function getBranchHeadMessageId({ branchId }) {
  if (!branchId) throw new Error('branchId is required');

  const db = getDb();
  const row = db.prepare(`
    SELECT head_message_id
    FROM conversation_branches
    WHERE id = @branchId
      AND archived_at IS NULL
  `).get({ branchId });

  return row?.head_message_id ?? null;
}

export function setConversationActiveBranch({ conversationId, branchId, userId }) {
  if (!conversationId) throw new Error('conversationId is required');
  if (!branchId) throw new Error('branchId is required');
  if (!userId) throw new Error('userId is required');

  const branch = getConversationBranch({ conversationId, branchId, userId });
  if (!branch) return false;

  const db = getDb();
  const now = new Date().toISOString();
  const info = db.prepare(`
    UPDATE conversations
    SET active_branch_id = @branchId, updated_at = @now
    WHERE id = @conversationId
      AND user_id = @userId
      AND deleted_at IS NULL
  `).run({
    conversationId,
    branchId,
    userId,
    now,
  });

  return info.changes > 0;
}

export function updateConversationBranchHead({ branchId, headMessageId, conversationId = null }) {
  if (!branchId) throw new Error('branchId is required');

  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE conversation_branches
    SET head_message_id = @headMessageId, updated_at = @now
    WHERE id = @branchId
      ${conversationId ? 'AND conversation_id = @conversationId' : ''}
  `).run({
    branchId,
    headMessageId,
    now,
    ...(conversationId ? { conversationId } : {}),
  });
}

export function deleteConversationBranch({ conversationId, branchId, userId }) {
  if (!conversationId) throw new Error('conversationId is required');
  if (!branchId) throw new Error('branchId is required');
  if (!userId) throw new Error('userId is required');

  const db = getDb();
  
  // We don't delete the root branch
  if (branchId === getRootBranchId(conversationId)) {
    return false;
  }

  // Use a transaction to ensure atomic cleanup
  const transaction = db.transaction(() => {
    // 1. Delete message events
    const me = db.prepare(`
      DELETE FROM message_events 
      WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = @conversationId AND branch_id = @branchId)
    `).run({ conversationId, branchId });

    // 2. Delete tool calls/outputs
    const tc = db.prepare(`
      DELETE FROM tool_calls
      WHERE conversation_id = @conversationId AND message_id IN (SELECT id FROM messages WHERE branch_id = @branchId)
    `).run({ conversationId, branchId });

    const to = db.prepare(`
      DELETE FROM tool_outputs
      WHERE conversation_id = @conversationId AND message_id IN (SELECT id FROM messages WHERE branch_id = @branchId)
    `).run({ conversationId, branchId });

    // 3. Delete messages
    const ms = db.prepare(`
      DELETE FROM messages 
      WHERE conversation_id = @conversationId AND branch_id = @branchId
    `).run({ conversationId, branchId });

    // 4. Delete the branch itself
    const info = db.prepare(`
      DELETE FROM conversation_branches
      WHERE id = @branchId AND conversation_id = @conversationId AND user_id = @userId
    `).run({ branchId, conversationId, userId });

    return info.changes > 0;
  });

  return transaction();
}
