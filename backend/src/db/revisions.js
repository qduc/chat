import { getDb } from './client.js';
import { getConversationBranches } from './branches.js';
import { getAllMessagesForSync, getMessagesPage } from './messages.js';

function toRevisionEntry(message) {
  return {
    role: message.role,
    content: message.content ?? null,
    tool_calls: message.tool_calls ?? null,
    tool_outputs: message.tool_outputs ?? null,
    reasoning_details: message.reasoning_details ?? null,
    usage: message.usage ?? null,
  };
}

function getMessageRowByClientId({ conversationId, clientMessageId, userId }) {
  const db = getDb();
  const row = db.prepare(`
    SELECT m.id, m.client_message_id, m.content, m.content_json, m.role, m.branch_id, m.parent_message_id
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.conversation_id = @conversationId
      AND (m.client_message_id = @clientMessageId OR CAST(m.id AS TEXT) = @clientMessageId)
      AND c.user_id = @userId
      AND c.deleted_at IS NULL
    LIMIT 1
  `).get({ conversationId, clientMessageId, userId });

  if (!row) return null;
  if (row.content_json) {
    try {
      row.content = JSON.parse(row.content_json);
    } catch {
      // Keep plain-text fallback from content column
    }
  }
  delete row.content_json;
  return row;
}

function getClientIdsByDbId({ conversationId, userId }) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT m.id, m.client_message_id
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.conversation_id = @conversationId
      AND c.user_id = @userId
      AND c.deleted_at IS NULL
  `).all({ conversationId, userId });

  return new Map(rows.map((row) => [row.id, row.client_message_id || String(row.id)]));
}

export function saveMessageRevision() {
  throw new Error('saveMessageRevision is no longer supported; use branches instead');
}

export function getMessageRevisions({ conversationId, anchorMessageId, userId }) {
  if (!userId) throw new Error('userId is required');

  const sourceMessage = getMessageRowByClientId({ conversationId, clientMessageId: anchorMessageId, userId });
  if (!sourceMessage) return [];

  const branches = getConversationBranches({ conversationId, userId })
    .filter((branch) => branch.source_message_id === sourceMessage.id)
    .filter((branch) => branch.operation_type === 'edit' || branch.operation_type === 'regenerate');

  return branches.map((branch) => {
    const timeline = getMessagesPage({
      conversationId,
      branchId: branch.id,
      afterSeq: 0,
      limit: 200,
    }).messages;

    const firstBranchMessage = timeline.find((message) => message.branch_id === branch.id) || null;
    let anchorContent = sourceMessage.content ?? null;
    let followUps = [];

    if (branch.operation_type === 'edit') {
      anchorContent = firstBranchMessage?.content ?? sourceMessage.content ?? null;
      if (firstBranchMessage) {
        const firstIndex = timeline.findIndex((message) => message._dbId === firstBranchMessage._dbId);
        followUps = firstIndex >= 0 ? timeline.slice(firstIndex + 1).map(toRevisionEntry) : [];
      }
    } else {
      const parentTimeline = branch.parent_branch_id
        ? getMessagesPage({
            conversationId,
            branchId: branch.parent_branch_id,
            afterSeq: 0,
            limit: 200,
          }).messages
        : timeline;
      const sourceIndex = parentTimeline.findIndex((message) => String(message.id) === anchorMessageId);
      followUps = sourceIndex >= 0
        ? parentTimeline.slice(sourceIndex + 1).map(toRevisionEntry)
        : [];
    }

    return {
      id: branch.id,
      operation_type: branch.operation_type,
      anchor_content: anchorContent,
      follow_ups: followUps,
      created_at: branch.created_at,
    };
  });
}

export function getRevisionCountsForConversation({ conversationId, userId }) {
  if (!userId) throw new Error('userId is required');

  const visibleMessages = getAllMessagesForSync({ conversationId });
  const visibleSourceIds = new Set(visibleMessages.map((message) => message._dbId).filter(Boolean));
  const clientIdsByDbId = getClientIdsByDbId({ conversationId, userId });
  const branches = getConversationBranches({ conversationId, userId });
  const counts = {
    edit: {},
    regenerate: {},
  };

  for (const branch of branches) {
    if (!branch.source_message_id || !visibleSourceIds.has(branch.source_message_id)) {
      continue;
    }
    if (branch.operation_type !== 'edit' && branch.operation_type !== 'regenerate') {
      continue;
    }

    const anchorMessageId = clientIdsByDbId.get(branch.source_message_id);
    if (!anchorMessageId) continue;
    counts[branch.operation_type][anchorMessageId] =
      (counts[branch.operation_type][anchorMessageId] || 0) + 1;
  }

  return counts;
}

export function getMessageRevisionCount({
  conversationId,
  anchorMessageId,
  userId,
  operationType,
}) {
  if (!userId) throw new Error('userId is required');

  const sourceMessage = getMessageRowByClientId({ conversationId, clientMessageId: anchorMessageId, userId });
  if (!sourceMessage) return 0;

  return getConversationBranches({ conversationId, userId }).filter((branch) => (
    branch.source_message_id === sourceMessage.id &&
    branch.operation_type === operationType
  )).length;
}
