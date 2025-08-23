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

export async function proxyOpenAIRequest(req, res) {
  const bodyIn = req.body || {};

  // Pull optional conversation_id from body or header
  const conversationId = bodyIn.conversation_id || req.header('x-conversation-id');

  // Determine which API to use
  const useResponsesAPI = !bodyIn.disable_responses_api && config.openaiBaseUrl.includes('openai.com');
  
  // Clone and strip non-upstream fields
  const body = { ...bodyIn };
  delete body.conversation_id;
  delete body.disable_responses_api;
  if (!body.model) body.model = config.defaultModel;
  const stream = !!body.stream;
  
  // Convert Chat Completions format to Responses API format if needed
  if (useResponsesAPI && body.messages) {
    body.input = body.messages;
    delete body.messages;
  }

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

    const url = useResponsesAPI 
      ? `${config.openaiBaseUrl}/responses` 
      : `${config.openaiBaseUrl}/chat/completions`;
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
      
      // Handle different response formats and convert if needed
      let content = null;
      let finishReason = null;
      let responseToSend = json;
      
      if (useResponsesAPI && json?.output?.[0]?.content?.[0]?.text) {
        // Responses API format - extract content
        content = json.output[0].content[0].text;
        finishReason = json.status === 'completed' ? 'stop' : null;
        
        // Convert to Chat Completions format for /v1/chat/completions endpoint
        if (req.path === '/v1/chat/completions') {
          responseToSend = {
            id: json.id,
            object: "chat.completion",
            created: json.created_at,
            model: json.model,
            choices: [{
              index: 0,
              message: {
                role: "assistant",
                content: content
              },
              finish_reason: finishReason
            }],
            usage: json.usage
          };
        }
      } else if (json?.choices?.[0]?.message?.content) {
        // Chat Completions API format
        content = json.choices[0].message.content;
        finishReason = json.choices[0].finish_reason;
      }
      
      // If non-streaming and persistence was set up, finalize assistant with full content if present
      if (persist && assistantMessageId && content) {
        appendAssistantContent({ messageId: assistantMessageId, delta: content });
        finalizeAssistantMessage({ messageId: assistantMessageId, finishReason: finishReason || null });
      }
      res.status(upstream.status).json(responseToSend);
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
        
        // Handle stream format conversion if needed
        if (useResponsesAPI && req.path === '/v1/chat/completions') {
          // Convert Responses API streaming to Chat Completions format
          let data = leftover + s;
          const parts = data.split(/\n\n/);
          leftover = parts.pop() || '';
          
          for (const part of parts) {
            const lines = part.split('\n');
            for (const line of lines) {
              const dataMatch = line.match(/^data:\s*(.*)$/);
              
              if (dataMatch) {
                const payload = dataMatch[1];
                if (payload === '[DONE]') {
                  res.write('data: [DONE]\n\n');
                  finished = true;
                  break;
                }
                
                try {
                  const obj = JSON.parse(payload);
                  
                  // Convert Responses API events to Chat Completions format
                  if (obj.type === 'response.output_text.delta' && obj.delta) {
                    const chatCompletionChunk = {
                      id: obj.item_id,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: "gpt-3.5-turbo",
                      choices: [{
                        index: 0,
                        delta: { content: obj.delta },
                        finish_reason: null
                      }]
                    };
                    res.write(`data: ${JSON.stringify(chatCompletionChunk)}\n\n`);
                    
                    // Handle persistence
                    if (persist && obj.delta) {
                      buffer += obj.delta;
                      if (buffer.length >= sizeThreshold) doFlush();
                    }
                  } else if (obj.type === 'response.completed') {
                    const chatCompletionChunk = {
                      id: obj.response.id,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: obj.response.model,
                      choices: [{
                        index: 0,
                        delta: {},
                        finish_reason: "stop"
                      }]
                    };
                    res.write(`data: ${JSON.stringify(chatCompletionChunk)}\n\n`);
                    lastFinishReason = 'stop';
                  }
                } catch (e) {
                  // not JSON; ignore
                }
              }
            }
          }
          if (typeof res.flush === 'function') res.flush();
        } else {
          // Direct passthrough for native format or Chat Completions API
          res.write(chunk);
          if (typeof res.flush === 'function') res.flush();
          
          if (!persist) return;
          
          let data = leftover + s;
          const parts = data.split(/\n\n/);
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
                
                // Handle persistence for different formats
                let deltaContent = null;
                let finishReason = null;
                
                if (useResponsesAPI && obj.type === 'response.output_text.delta') {
                  deltaContent = obj.delta;
                } else if (obj?.choices?.[0]?.delta?.content) {
                  deltaContent = obj.choices[0].delta.content;
                  finishReason = obj.choices[0].finish_reason;
                }
                
                if (deltaContent) {
                  buffer += deltaContent;
                  if (buffer.length >= sizeThreshold) doFlush();
                }
                if (finishReason) {
                  lastFinishReason = finishReason;
                }
              } catch (e) {
                // not JSON; ignore
              }
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
