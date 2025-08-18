import { Router } from 'express';
import { config } from '../env.js';
import { getDb, upsertSession, createConversation, getConversationById } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

export const conversationsRouter = Router();

function notImplemented(res) {
  return res.status(501).json({ error: 'not_implemented', message: 'Conversation history is disabled' });
}

// POST /v1/conversations
conversationsRouter.post('/v1/conversations', (req, res) => {
  if (!config.persistence.enabled) return notImplemented(res);
  try {
    const sessionId = req.sessionId;
    if (!sessionId) return res.status(400).json({ error: 'bad_request', message: 'Missing session id' });

    // Ensure DB and session row
    getDb();
    upsertSession(sessionId, { userAgent: req.header('user-agent') || null });

    const { title, model } = req.body || {};
    const id = uuidv4();
    createConversation({ id, sessionId, title, model });
    const convo = getConversationById({ id, sessionId });
    return res.status(201).json(convo);
  } catch (e) {
    console.error('[conversations] create error', e);
    if (String(e.message || '').includes('DB_URL') || String(e.message || '').includes('SQLite')) {
      return res.status(500).json({ error: 'db_error', message: e.message });
    }
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /v1/conversations/:id
conversationsRouter.get('/v1/conversations/:id', (req, res) => {
  if (!config.persistence.enabled) return notImplemented(res);
  try {
    const sessionId = req.sessionId;
    if (!sessionId) return res.status(400).json({ error: 'bad_request', message: 'Missing session id' });

    getDb();
    const convo = getConversationById({ id: req.params.id, sessionId });
    if (!convo) return res.status(404).json({ error: 'not_found' });
    return res.json(convo);
  } catch (e) {
    console.error('[conversations] get error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});
