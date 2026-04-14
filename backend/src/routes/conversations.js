import { createHash } from 'crypto';
import { Router } from 'express';
import { config } from '../env.js';
import { getDb } from '../db/client.js';
import { upsertSession } from '../db/sessions.js';
import { authenticateToken } from '../middleware/auth.js';
import { logger } from '../logger.js';
import {
  createConversation,
  getConversationById,
  listConversations,
  searchConversations,
  softDeleteConversation,
  listConversationsIncludingDeleted,
  getLinkedConversations,
} from '../db/conversations.js';
import {
  getMessagesPage,
  getNextSeq,
  insertUserMessage,
  getMessageContentByClientId,
  updateMessageContent,
} from '../db/messages.js';
import { listEvaluationsForConversation } from '../db/evaluations.js';
import {
  getMessageRevisions,
  getRevisionCountsForConversation,
  getMessageRevisionCount,
} from '../db/revisions.js';
import {
  createConversationBranch,
  getActiveBranchId,
  getConversationBranches,
  setConversationActiveBranch,
} from '../db/branches.js';
import {
  migrateSessionConversationsToUser,
  countMigratableConversations
} from '../db/migration.js';
import { v4 as uuidv4 } from 'uuid';
import { normalizeCustomRequestParamsIds } from '../lib/customRequestParams.js';

export const conversationsRouter = Router();

// Apply authentication to all conversation routes
conversationsRouter.use(authenticateToken);

function notImplemented(res) {
  return res.status(501).json({ error: 'not_implemented' });
}

// POST /v1/conversations/migrate (migrate anonymous conversations to authenticated user)
conversationsRouter.post('/v1/conversations/migrate', (req, res) => {
  if (!config.persistence.enabled) return notImplemented(res);
  try {
    const userId = req.user.id;
    const sessionId = req.sessionId;

    if (!sessionId) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'Session ID required for migration'
      });
    }

    // Check how many conversations can be migrated
    const migratableCount = countMigratableConversations(sessionId);

    if (migratableCount === 0) {
      return res.json({
        migrated: 0,
        message: 'No anonymous conversations found to migrate'
      });
    }

    // Perform the migration
    const migratedCount = migrateSessionConversationsToUser(sessionId, userId);

    return res.json({
      migrated: migratedCount,
      message: `Successfully migrated ${migratedCount} conversations to your account`
    });
  } catch (e) {
    logger.error('[conversations] migrate error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /v1/conversations (list with cursor+limit, optional search)
conversationsRouter.get('/v1/conversations', (req, res) => {
  if (!config.persistence.enabled) return notImplemented(res);
  try {
    const userId = req.user.id; // Guaranteed by authenticateToken middleware

    getDb();
    const { cursor, limit, include_deleted, search } = req.query || {};
    const includeDeleted =
      String(include_deleted) === '1' ||
      String(include_deleted).toLowerCase() === 'true';

    // If search query is provided, use searchConversations
    if (search && String(search).trim()) {
      const result = searchConversations({
        userId,
        search: String(search).trim(),
        limit,
      });
      return res.json(result);
    }

    const result = includeDeleted
      ? listConversationsIncludingDeleted({
        userId,
        cursor,
        limit,
        includeDeleted: true,
      })
      : listConversations({ userId, cursor, limit });
    return res.json(result);
  } catch (e) {
    logger.error('[conversations] list error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /v1/conversations
conversationsRouter.post('/v1/conversations', (req, res) => {
  if (!config.persistence.enabled) return notImplemented(res);
  try {
    const sessionId = req.sessionId;
    const userId = req.user.id; // Guaranteed by authenticateToken middleware

    // Ensure DB and session row (still needed for session-based users)
    getDb();
    if (sessionId) {
      const sessionMeta = req.sessionMeta || {
        userAgent: req.header('user-agent') || null,
        ipHash: req.ip
          ? createHash('sha256').update(req.ip).digest('hex').substring(0, 16)
          : null,
      };
      upsertSession(sessionId, { userId, ...sessionMeta });
    }

    const {
      title,
      provider_id,
      model,
      streamingEnabled,
      toolsEnabled,
      reasoningEffort,
      verbosity,
      custom_request_params_id,
    } = req.body || {};
    const sysPrompt = typeof req.body?.system_prompt === 'string' ? req.body.system_prompt.trim() : (
      typeof req.body?.systemPrompt === 'string' ? req.body.systemPrompt.trim() : ''
    );
      const customRequestParamsId = normalizeCustomRequestParamsIds(custom_request_params_id);
    const id = uuidv4();
    const metadata = {
      ...(sysPrompt ? { system_prompt: sysPrompt } : {}),
      ...(customRequestParamsId !== undefined ? { custom_request_params_id: customRequestParamsId } : {}),
    };
    createConversation({
      id,
      sessionId,
      userId,
      title,
      provider_id,
      model,
      streamingEnabled,
      toolsEnabled,
      reasoningEffort,
      verbosity,
      metadata,
    });
    const convo = getConversationById({ id, userId });

    const response = {
      ...convo,
      system_prompt: convo?.metadata?.system_prompt || null,
      active_system_prompt_id: convo?.metadata?.active_system_prompt_id || null,
      custom_request_params_id: Object.hasOwn(convo?.metadata || {}, 'custom_request_params_id')
        ? convo?.metadata?.custom_request_params_id
        : null,
    };

    return res.status(201).json(response);
  } catch (e) {
    logger.error('[conversations] create error', e);
    if (
      String(e.message || '').includes('DB_URL') ||
      String(e.message || '').includes('SQLite')
    ) {
      return res.status(500).json({ error: 'db_error', message: e.message });
    }
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /v1/conversations/:id (metadata + messages with pagination)
// Optional: ?include_linked=messages to include linked conversations with their messages
conversationsRouter.get('/v1/conversations/:id', (req, res) => {
  if (!config.persistence.enabled) return notImplemented(res);
  try {
    const userId = req.user.id; // Guaranteed by authenticateToken middleware

    getDb();
    const convo = getConversationById({ id: req.params.id, userId });
    if (!convo) return res.status(404).json({ error: 'not_found' });

    const after_seq = req.query.after_seq ? Number(req.query.after_seq) : 0;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const branchId = typeof req.query.branch_id === 'string' && req.query.branch_id.trim()
      ? req.query.branch_id.trim()
      : null;
    const page = getMessagesPage({
      conversationId: req.params.id,
      branchId,
      afterSeq: after_seq,
      limit,
    });

    const sysPrompt = convo?.metadata?.system_prompt || null;
    const activePromptId = convo?.metadata?.active_system_prompt_id || null;
    const customRequestParamsId = Object.hasOwn(convo?.metadata || {}, 'custom_request_params_id')
      ? convo?.metadata?.custom_request_params_id
      : null;

    const response = {
      ...convo,
      system_prompt: sysPrompt,
      active_system_prompt_id: activePromptId,
      custom_request_params_id: customRequestParamsId,
      active_branch_id: branchId || convo.active_branch_id || null,
      messages: page.messages,
      evaluations: listEvaluationsForConversation({ conversationId: req.params.id, userId }),
      revision_counts: getRevisionCountsForConversation({ conversationId: req.params.id, userId, branchId: branchId || null }),
      branches: getConversationBranches({ conversationId: req.params.id, userId }),
      next_after_seq: page.next_after_seq,
    };

    // Include linked conversations with their messages if requested
    const includeLinked = req.query.include_linked;
    if (includeLinked === 'messages') {
      const linkedConvos = getLinkedConversations({ parentId: req.params.id, userId });
      response.linked_conversations = linkedConvos.map((linked) => {
        const linkedPage = getMessagesPage({
          conversationId: linked.id,
          branchId: linked.active_branch_id || null,
          afterSeq: 0,
          limit: 200, // Get all messages for linked conversations
        });
        return {
          ...linked,
          messages: linkedPage.messages,
        };
      });
    }

    return res.json(response);
  } catch (e) {
    logger.error('[conversations] get error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// DELETE /v1/conversations/:id (soft delete)
conversationsRouter.delete('/v1/conversations/:id', (req, res) => {
  if (!config.persistence.enabled) return notImplemented(res);
  try {
    const userId = req.user.id; // Guaranteed by authenticateToken middleware

    getDb();
    const ok = softDeleteConversation({ id: req.params.id, userId });
    if (!ok) return res.status(404).json({ error: 'not_found' });
    return res.status(204).end();
  } catch (e) {
    logger.error('[conversations] delete error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /v1/conversations/:id/linked (get linked comparison conversations)
conversationsRouter.get('/v1/conversations/:id/linked', (req, res) => {
  if (!config.persistence.enabled) return notImplemented(res);
  try {
    const userId = req.user.id; // Guaranteed by authenticateToken middleware

    getDb();
    // First verify the parent conversation exists and belongs to the user
    const parentConvo = getConversationById({ id: req.params.id, userId });
    if (!parentConvo) return res.status(404).json({ error: 'not_found' });

    const linkedConversations = getLinkedConversations({ parentId: req.params.id, userId });
    return res.json({ conversations: linkedConversations });
  } catch (e) {
    logger.error('[conversations] get linked error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

conversationsRouter.get('/v1/conversations/:id/branches', (req, res) => {
  if (!config.persistence.enabled) return notImplemented(res);
  try {
    const userId = req.user.id;
    getDb();

    const convo = getConversationById({ id: req.params.id, userId });
    if (!convo) return res.status(404).json({ error: 'not_found' });

    return res.json({
      active_branch_id: convo.active_branch_id || null,
      branches: getConversationBranches({ conversationId: req.params.id, userId }),
    });
  } catch (e) {
    logger.error('[conversations] get branches error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

conversationsRouter.post('/v1/conversations/:id/branches/:branchId/switch', (req, res) => {
  if (!config.persistence.enabled) return notImplemented(res);
  try {
    const userId = req.user.id;
    getDb();

    const ok = setConversationActiveBranch({
      conversationId: req.params.id,
      branchId: req.params.branchId,
      userId,
    });
    if (!ok) return res.status(404).json({ error: 'not_found' });

    return res.json({
      conversation_id: req.params.id,
      active_branch_id: req.params.branchId,
    });
  } catch (e) {
    logger.error('[conversations] switch branch error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// PUT /v1/conversations/:id/messages/:messageId/edit (edit message and create a new branch)
conversationsRouter.put('/v1/conversations/:id/messages/:messageId/edit', (req, res) => {
  if (!config.persistence.enabled) return notImplemented(res);
  try {
    const userId = req.user.id; // Guaranteed by authenticateToken middleware

    const { content } = req.body || {};
    if (!content) {
      return res
        .status(400)
        .json({ error: 'bad_request', message: 'Message content is required' });
    }

    // Validate content type: must be string or array
    if (typeof content !== 'string' && !Array.isArray(content)) {
      return res
        .status(400)
        .json({ error: 'bad_request', message: 'Message content must be a string or array' });
    }

    // If content is a string, trim it and validate it's not empty
    // If content is an array (mixed content), validate it has at least some text or attachments
    let validatedContent;
    if (typeof content === 'string') {
      validatedContent = content.trim();
      if (!validatedContent) {
        return res
          .status(400)
          .json({ error: 'bad_request', message: 'Message content cannot be empty' });
      }
    } else {
      // Array content: ensure it has at least one text, image, or audio item
      const hasTextContent = content.some(item => item?.type === 'text' && item.text?.trim());
      const hasImageContent = content.some(item => item?.type === 'image_url');
      const hasAudioContent = content.some(item => item?.type === 'input_audio');
      if (!hasTextContent && !hasImageContent && !hasAudioContent) {
        return res
          .status(400)
          .json({ error: 'bad_request', message: 'Message content cannot be empty' });
      }
      validatedContent = content;
    }

    getDb();

    // Look up the active branch first so we can scope the message lookup to the correct branch
    const activeBranchId = getActiveBranchId({ conversationId: req.params.id, userId });

    // Look up the message using client_message_id or integer id (handles UUID from frontend)
    // Scope the search to the active branch to prevent editing messages from archived branches
    const existingMessage = getMessageContentByClientId({
      conversationId: req.params.id,
      clientMessageId: req.params.messageId,
      userId,
      branchId: activeBranchId,
    });

    if (!existingMessage) {
      return res.status(404).json({ error: 'not_found' });
    }

    if (existingMessage.role !== 'user') {
      return res
        .status(400)
        .json({ error: 'bad_request', message: 'Only user messages can be edited' });
    }

    const noBranch = req.body.no_branch === true;
    const anchorMessageId = existingMessage.client_message_id || String(existingMessage.id);

    if (noBranch) {
      // In-place update: overwrite the message content without creating a revision branch.
      // Used in compare mode where revision history is intentionally suppressed.
      updateMessageContent({
        messageId: existingMessage.id,
        conversationId: req.params.id,
        userId,
        content: validatedContent,
      });

      const editRevisionCount = getMessageRevisionCount({
        conversationId: req.params.id,
        anchorMessageId,
        userId,
        operationType: 'edit',
      });

      return res.json({
        message: {
          id: anchorMessageId,
          seq: existingMessage.seq,
          content: validatedContent,
        },
        new_conversation_id: req.params.id,
        edit_revision_count: editRevisionCount,
      });
    }

    let newBranchId, clientMessageId, message;
    const db = getDb();
    db.transaction(() => {
      newBranchId = createConversationBranch({
        conversationId: req.params.id,
        userId,
        parentBranchId: activeBranchId,
        branchPointMessageId: existingMessage.parent_message_id ?? null,
        sourceMessageId: existingMessage.id,
        operationType: 'edit',
        label: null,
        headMessageId: existingMessage.parent_message_id ?? null,
      });
      const ok = setConversationActiveBranch({
        conversationId: req.params.id,
        branchId: newBranchId,
        userId,
      });
      if (!ok) throw new Error(`Failed to activate new branch ${newBranchId}`);

      const nextSeq = getNextSeq(req.params.id);
      clientMessageId = uuidv4();
      message = insertUserMessage({
        conversationId: req.params.id,
        content: validatedContent,
        seq: nextSeq,
        clientMessageId,
        branchId: newBranchId,
        parentMessageId: existingMessage.parent_message_id ?? null,
      });
    })();

    const editRevisionCount = getMessageRevisionCount({
      conversationId: req.params.id,
      anchorMessageId,
      userId,
      operationType: 'edit',
    });

    return res.json({
      message: {
        id: clientMessageId,
        seq: message.seq,
        content: validatedContent,
      },
      new_conversation_id: req.params.id,
      branch_id: newBranchId,
      active_branch_id: newBranchId,
      edit_revision_count: editRevisionCount,
    });
  } catch (e) {
    logger.error('[conversations] edit message error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /v1/conversations/:id/messages/:messageId/revisions
conversationsRouter.get('/v1/conversations/:id/messages/:messageId/revisions', (req, res) => {
  if (!config.persistence.enabled) return notImplemented(res);
  try {
    const userId = req.user.id;
    getDb();

    const revisions = getMessageRevisions({
      conversationId: req.params.id,
      anchorMessageId: req.params.messageId,
      userId,
    });

    return res.json({ revisions });
  } catch (e) {
    logger.error('[conversations] get revisions error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});
