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
  softDeleteConversation,
  listConversationsIncludingDeleted,
  forkConversationFromMessage,
  getLinkedConversations,
} from '../db/conversations.js';
import {
  getMessagesPage,
  updateMessageContent,
  deleteMessagesAfterSeq,
} from '../db/messages.js';
import { listEvaluationsForConversation } from '../db/evaluations.js';
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

// GET /v1/conversations (list with cursor+limit)
conversationsRouter.get('/v1/conversations', (req, res) => {
  if (!config.persistence.enabled) return notImplemented(res);
  try {
    const userId = req.user.id; // Guaranteed by authenticateToken middleware

    getDb();
    const { cursor, limit, include_deleted } = req.query || {};
    const includeDeleted =
      String(include_deleted) === '1' ||
      String(include_deleted).toLowerCase() === 'true';
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
      qualityLevel,
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
      qualityLevel,
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
    const page = getMessagesPage({
      conversationId: req.params.id,
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
      messages: page.messages,
      evaluations: listEvaluationsForConversation({ conversationId: req.params.id, userId }),
      next_after_seq: page.next_after_seq,
    };

    // Include linked conversations with their messages if requested
    const includeLinked = req.query.include_linked;
    if (includeLinked === 'messages') {
      const linkedConvos = getLinkedConversations({ parentId: req.params.id, userId });
      response.linked_conversations = linkedConvos.map((linked) => {
        const linkedPage = getMessagesPage({
          conversationId: linked.id,
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

// PUT /v1/conversations/:id/messages/:messageId/edit (edit message and fork conversation)
conversationsRouter.put('/v1/conversations/:id/messages/:messageId/edit', (req, res) => {
  if (!config.persistence.enabled) return notImplemented(res);
  try {
    const sessionId = req.sessionId;
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

    // Update the message content (supports both string and mixed content array)
    const message = updateMessageContent({
      messageId: req.params.messageId,
      conversationId: req.params.id,
      userId,
      content: validatedContent,
    });

    if (!message) {
      return res.status(404).json({ error: 'not_found' });
    }

    // Get conversation details for forking
    const conversation = getConversationById({ id: req.params.id, userId });
    if (!conversation) {
      return res.status(404).json({ error: 'not_found' });
    }

    // Fork conversation from the edited message
    const newConversationId = forkConversationFromMessage({
      originalConversationId: req.params.id,
      sessionId,
      userId,
      messageSeq: message.seq,
      title: conversation.title,
      provider_id: conversation.provider_id,
      model: conversation.model,
    });

    // Delete messages after the edited message in the original conversation
    deleteMessagesAfterSeq({
      conversationId: req.params.id,
      userId,
      afterSeq: message.seq,
    });

    return res.json({
      message: {
        id: message.id,
        seq: message.seq,
        content: validatedContent,
      },
      new_conversation_id: newConversationId,
    });
  } catch (e) {
    logger.error('[conversations] edit message error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});
