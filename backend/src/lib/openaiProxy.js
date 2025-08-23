import fetch from 'node-fetch';
import { config } from '../env.js';
import {
  getDb,
  upsertSession,
  getConversationById,
  countMessagesByConversation,
  getNextSeq,
  insertUserMessage,
  createAssistantDraft,
  appendAssistantContent,
  finalizeAssistantMessage,
  markAssistantError
} from '../db/index.js';

export async function proxyChatCompletion(req, res) {
  const bodyIn = req.body || {};

  // Pull optional conversation_id from body or header
  const conversationId = bodyIn.conversation_id || req.header('x-conversation-id');

  // Clone and strip non-upstream fields
  const body = { ...bodyIn };
  delete body.conversation_id;
  if (!body.model) body.model = config.defaultModel;
  const stream = !!body.stream;

  // Optional persistence setup
  let persist = false;
  let assistantMessageId = null;
  let sessionId = req.sessionId;
  let buffer = '';
  let flushedOnce = false;
  let flushTimer = null;
  let finished = false;
  let lastFinishReason = null;

  const sizeThreshold = 512;
  const flushMs = config.persistence.historyBatchFlushMs;

  try {
    if (config.persistence.enabled && conversationId && sessionId) {
      // Ensure DB session row
      getDb();
      upsertSession(sessionId, { userAgent: req.header('user-agent') || null });

      // Guard conversation ownership
      const convo = getConversationById({ id: conversationId, sessionId });
      if (convo) {
        // Enforce message limit
        const cnt = countMessagesByConversation(conversationId);
        if (cnt >= config.persistence.maxMessagesPerConversation) {
          return res.status(429).json({ error: 'limit_exceeded', message: 'Max messages per conversation reached' });
        }

        // Determine next seq for user and assistant
        const userSeq = getNextSeq(conversationId);

        // Persist user message if available
        const msgs = Array.isArray(bodyIn.messages) ? bodyIn.messages : [];
        const lastUser = [...msgs].reverse().find(m => m && m.role === 'user' && typeof m.content === 'string');
        if (lastUser) {
          insertUserMessage({ conversationId, content: lastUser.content, seq: userSeq });
        }
        // Assistant seq right after
        const assistantSeq = userSeq + 1;
        const draft = createAssistantDraft({ conversationId, seq: assistantSeq });
        assistantMessageId = draft.id;
        persist = true;
      }
    }

    const url = `${config.openaiBaseUrl}/chat/completions`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openaiApiKey}`
    };

    const upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!stream || upstream.headers.get('content-type')?.includes('application/json')) {
      const json = await upstream.json();
      // If non-streaming and persistence was set up, finalize assistant with full content if present
      if (persist && assistantMessageId && json?.choices?.[0]?.message?.content) {
        appendAssistantContent({ messageId: assistantMessageId, delta: json.choices[0].message.content });
        finalizeAssistantMessage({ messageId: assistantMessageId, finishReason: json?.choices?.[0]?.finish_reason || null });
      }
      res.status(upstream.status).json(json);
      return;
    }

    // Stream (SSE) passthrough
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Ensure headers are sent immediately so the client can start processing
    // the event stream as soon as chunks arrive. Some proxies/browsers may
    // buffer the response if headers are not flushed explicitly.
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const doFlush = () => {
      if (!persist || !assistantMessageId) return;
      if (buffer.length === 0) return;
      appendAssistantContent({ messageId: assistantMessageId, delta: buffer });
      buffer = '';
      flushedOnce = true;
    };

    if (persist) {
      flushTimer = setInterval(() => {
        try { doFlush(); } catch (e) { console.error('[persist] flush error', e); }
      }, flushMs);
    }

    let leftover = '';

    upstream.body.on('data', chunk => {
      try {
        const s = String(chunk);
        // passthrough immediately and flush to the client so tokens render
        // incrementally instead of being buffered until the stream ends
        res.write(chunk);
        if (typeof res.flush === 'function') res.flush();

        if (!persist) return;

        let data = leftover + s;
        const parts = data.split(/\n\n/); // events typically separated by blank line
        leftover = parts.pop() || '';
        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            const m = line.match(/^data:\s*(.*)$/);
            if (!m) continue;
            const payload = m[1];
            if (payload === '[DONE]') {
              finished = true;
              break;
            }
            try {
              const obj = JSON.parse(payload);
              const choice = obj?.choices?.[0];
              if (choice?.delta?.content) {
                buffer += choice.delta.content;
                if (buffer.length >= sizeThreshold) doFlush();
              }
              if (choice?.finish_reason) {
                lastFinishReason = choice.finish_reason;
              }
            } catch (e) {
              // not JSON; ignore
            }
          }
        }
      } catch (e) {
        console.error('[proxy stream data] error', e);
      }
    });

    upstream.body.on('end', () => {
      try {
        if (persist && assistantMessageId) {
          doFlush();
          finalizeAssistantMessage({ messageId: assistantMessageId, finishReason: lastFinishReason || null, status: 'final' });
          if (flushTimer) clearInterval(flushTimer);
        }
      } catch (e) {
        console.error('[persist] finalize error', e);
      }
      res.end();
    });

    upstream.body.on('error', err => {
      console.error('Upstream stream error', err);
      try {
        if (persist && assistantMessageId) {
          doFlush();
          markAssistantError({ messageId: assistantMessageId });
          if (flushTimer) clearInterval(flushTimer);
        }
      } catch {}
      res.end();
    });

    // Client abort
    req.on('close', () => {
      if (res.writableEnded) return;
      try {
        if (persist && assistantMessageId) {
          doFlush();
          markAssistantError({ messageId: assistantMessageId });
          if (flushTimer) clearInterval(flushTimer);
        }
      } catch {}
    });
  } catch (e) {
    console.error('[proxy] error', e);
    // On synchronous error finalize as error
    try {
      if (persist && assistantMessageId) {
        markAssistantError({ messageId: assistantMessageId });
      }
    } catch {}
    res.status(500).json({ error: 'upstream_error', message: e.message });
  }
}
