import { Router } from 'express';
import { config } from '../env.js';
import {
  getDb,
  upsertSession,
  createConversation,
  getConversationById,
  countConversationsBySession,
  listConversations,
  getMessagesPage,
  softDeleteConversation,
  listConversationsIncludingDeleted,
} from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

export const conversationsRouter = Router();

function notImplemented(res) {
  return res
    .status(501)
    .json({
      error: 'not_implemented',
      message: 'Conversation history is disabled',
    });
}

// GET /v1/conversations (list with cursor+limit)
conversationsRouter.get('/v1/conversations', (req, res) => {
  if (!config.persistence.enabled) return notImplemented(res);
  try {
    const sessionId = req.sessionId;
    if (!sessionId)
      return res
        .status(400)
        .json({ error: 'bad_request', message: 'Missing session id' });
    getDb();
    const { cursor, limit, include_deleted } = req.query || {};
    const includeDeleted =
      String(include_deleted) === '1' ||
      String(include_deleted).toLowerCase() === 'true';
    const result = includeDeleted
      ? listConversationsIncludingDeleted({
          sessionId,
          cursor,
          limit,
          includeDeleted: true,
        })
      : listConversations({ sessionId, cursor, limit });
    return res.json(result);
  } catch (e) {
    console.error('[conversations] list error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /v1/conversations
conversationsRouter.post('/v1/conversations', (req, res) => {
  if (!config.persistence.enabled) return notImplemented(res);
  try {
    const sessionId = req.sessionId;
    if (!sessionId)
      return res
        .status(400)
        .json({ error: 'bad_request', message: 'Missing session id' });

    // Ensure DB and session row
    getDb();
    upsertSession(sessionId, { userAgent: req.header('user-agent') || null });

    // Enforce conversations per session limit
    const cnt = countConversationsBySession(sessionId);
    if (cnt >= config.persistence.maxConversationsPerSession) {
      return res
        .status(429)
        .json({
          error: 'limit_exceeded',
          message: 'Max conversations per session reached',
        });
    }

    const { title, model } = req.body || {};
    const id = uuidv4();
    createConversation({ id, sessionId, title, model });
    const convo = getConversationById({ id, sessionId });
    return res.status(201).json(convo);
  } catch (e) {
    console.error('[conversations] create error', e);
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
conversationsRouter.get('/v1/conversations/:id', (req, res) => {
  if (!config.persistence.enabled) return notImplemented(res);
  try {
    const sessionId = req.sessionId;
    if (!sessionId)
      return res
        .status(400)
        .json({ error: 'bad_request', message: 'Missing session id' });

    getDb();
    const convo = getConversationById({ id: req.params.id, sessionId });
    if (!convo) return res.status(404).json({ error: 'not_found' });

    const after_seq = req.query.after_seq ? Number(req.query.after_seq) : 0;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const page = getMessagesPage({
      conversationId: req.params.id,
      afterSeq: after_seq,
      limit,
    });

    return res.json({
      ...convo,
      messages: page.messages,
      next_after_seq: page.next_after_seq,
    });
  } catch (e) {
    console.error('[conversations] get error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// DELETE /v1/conversations/:id (soft delete)
conversationsRouter.delete('/v1/conversations/:id', (req, res) => {
  if (!config.persistence.enabled) return notImplemented(res);
  try {
    const sessionId = req.sessionId;
    if (!sessionId)
      return res
        .status(400)
        .json({ error: 'bad_request', message: 'Missing session id' });
    getDb();
    const ok = softDeleteConversation({ id: req.params.id, sessionId });
    if (!ok) return res.status(404).json({ error: 'not_found' });
    return res.status(204).end();
  } catch (e) {
    console.error('[conversations] delete error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});
