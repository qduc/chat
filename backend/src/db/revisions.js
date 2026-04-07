import { v4 as uuidv4 } from 'uuid';
import { getDb } from './client.js';
import { getAllMessagesForSync } from './messages.js';

function serializeContentSnapshot(content) {
  return content != null ? JSON.stringify(content) : null;
}

/**
 * Save a revision snapshot before an edit or regenerate operation discards old messages.
 *
 * @param {object} params
 * @param {string} params.conversationId
 * @param {string} params.userId
 * @param {string} params.anchorMessageId - client_message_id (UUID) of the user message
 * @param {'edit'|'regenerate'} params.operationType
 * @param {*} params.anchorContentSnapshot - user message content for the revision branch
 * @param {Array} params.followUpsSnapshot - array of follow-up message snapshots
 */
export function saveMessageRevision({
  conversationId,
  userId,
  anchorMessageId,
  operationType,
  anchorContentSnapshot,
  followUpsSnapshot,
}) {
  if (!userId) throw new Error('userId is required');
  if (!conversationId) throw new Error('conversationId is required');
  if (!anchorMessageId) throw new Error('anchorMessageId is required');

  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO message_revisions
      (id, conversation_id, user_id, anchor_message_id, operation_type, anchor_content_snapshot, follow_ups_snapshot, created_at)
    VALUES
      (@id, @conversationId, @userId, @anchorMessageId, @operationType, @anchorContentSnapshot, @followUpsSnapshot, @now)
  `).run({
    id,
    conversationId,
    userId,
    anchorMessageId,
    operationType,
    anchorContentSnapshot: serializeContentSnapshot(anchorContentSnapshot),
    followUpsSnapshot: JSON.stringify(followUpsSnapshot || []),
    now,
  });

  return id;
}

/**
 * Retrieve all revisions for a given user message, oldest first.
 */
export function getMessageRevisions({ conversationId, anchorMessageId, userId }) {
  if (!userId) throw new Error('userId is required');

  const db = getDb();
  const rows = db.prepare(`
    SELECT id, operation_type, anchor_content_snapshot, follow_ups_snapshot, created_at
    FROM message_revisions
    WHERE conversation_id = @conversationId
      AND anchor_message_id = @anchorMessageId
      AND user_id = @userId
    ORDER BY created_at ASC
  `).all({ conversationId, anchorMessageId, userId });

  return rows.map(row => ({
    id: row.id,
    operation_type: row.operation_type,
    anchor_content: row.anchor_content_snapshot != null
      ? JSON.parse(row.anchor_content_snapshot)
      : null,
    follow_ups: JSON.parse(row.follow_ups_snapshot || '[]'),
    created_at: row.created_at,
  }));
}

/**
 * Return split revision counts per anchor message for a conversation.
 * Returns { edit: { [anchorMessageId]: count }, regenerate: { [anchorMessageId]: count } }
 */
export function getRevisionCountsForConversation({ conversationId, userId }) {
  if (!userId) throw new Error('userId is required');

  const db = getDb();
  const editRows = db.prepare(`
    SELECT anchor_message_id, operation_type, COUNT(*) as count
    FROM message_revisions
    WHERE conversation_id = @conversationId
      AND user_id = @userId
      AND operation_type = 'edit'
    GROUP BY anchor_message_id, operation_type
  `).all({ conversationId, userId });
  const regenerateRows = db.prepare(`
    SELECT anchor_message_id, anchor_content_snapshot
    FROM message_revisions
    WHERE conversation_id = @conversationId
      AND user_id = @userId
      AND operation_type = 'regenerate'
    ORDER BY created_at ASC
  `).all({ conversationId, userId });

  const currentAnchorSnapshots = new Map(
    getAllMessagesForSync({ conversationId })
      .filter((message) => message.role === 'user')
      .map((message) => [String(message.id), serializeContentSnapshot(message.content)])
  );

  const edit = {};
  const regenerate = {};

  for (const row of editRows) {
    edit[row.anchor_message_id] = row.count;
  }

  for (const row of regenerateRows) {
    const currentSnapshot = currentAnchorSnapshots.get(row.anchor_message_id);
    if (currentSnapshot == null || row.anchor_content_snapshot !== currentSnapshot) {
      continue;
    }
    regenerate[row.anchor_message_id] = (regenerate[row.anchor_message_id] || 0) + 1;
  }

  return { edit, regenerate };
}

export function getMessageRevisionCount({
  conversationId,
  anchorMessageId,
  userId,
  operationType,
  anchorContentSnapshot,
}) {
  if (!userId) throw new Error('userId is required');

  const db = getDb();
  const params = {
    conversationId,
    anchorMessageId,
    userId,
    operationType,
    anchorContentSnapshot: serializeContentSnapshot(anchorContentSnapshot),
  };
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM message_revisions
    WHERE conversation_id = @conversationId
      AND anchor_message_id = @anchorMessageId
      AND user_id = @userId
      AND operation_type = @operationType
      AND (
        @anchorContentSnapshot IS NULL
        OR anchor_content_snapshot = @anchorContentSnapshot
      )
  `).get(params);

  return Number(row?.count || 0);
}
