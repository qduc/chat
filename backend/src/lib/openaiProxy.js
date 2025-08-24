import fetch from 'node-fetch';
import { config } from '../env.js';
import { tools as toolRegistry } from './tools.js';
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
  markAssistantError,
} from '../db/index.js';

export async function proxyOpenAIRequest(req, res) {
  const bodyIn = req.body || {};

  // Pull optional conversation_id from body or header
  const conversationId =
    bodyIn.conversation_id || req.header('x-conversation-id');

  // Pull optional previous_response_id for Responses API conversation continuity
  const previousResponseId =
    bodyIn.previous_response_id || req.header('x-previous-response-id');

  // Determine which API to use
  let useResponsesAPI =
    !bodyIn.disable_responses_api &&
    config.openaiBaseUrl.includes('openai.com');

  // If tools are present, force Chat Completions path for MVP (server orchestration)
  const hasTools = Array.isArray(bodyIn.tools) && bodyIn.tools.length > 0;
  if (hasTools) useResponsesAPI = false;

  // Clone and strip non-upstream fields
  const body = { ...bodyIn };
  delete body.conversation_id;
  delete body.disable_responses_api;
  delete body.previous_response_id;
  if (!body.model) body.model = config.defaultModel;
  const stream = !!body.stream;

  // Convert Chat Completions format to Responses API format if needed (no tools in MVP)
  if (useResponsesAPI && body.messages) {
    // For Responses API, only send the latest user message to reduce token usage
    const lastUserMessage = [...body.messages]
      .reverse()
      .find((m) => m && m.role === 'user');
    body.input = lastUserMessage ? [lastUserMessage] : [];
    delete body.messages;

    // Add previous_response_id for conversation continuity if provided
    if (previousResponseId) {
      body.previous_response_id = previousResponseId;
    }
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
    // Helper to execute a single tool call (MVP: local registry only)
    async function executeToolCall(call) {
      const name = call?.function?.name;
      const argsStr = call?.function?.arguments || '{}';
      const tool = toolRegistry[name];
      if (!tool) throw new Error(`unknown_tool: ${name}`);
      let args;
      try {
        args = JSON.parse(argsStr || '{}');
      } catch (e) {
        throw new Error('invalid_arguments_json');
      }
      const validated = tool.validate ? tool.validate(args) : args;
      const output = await tool.handler(validated);
      return { name, output };
    }

    // Orchestrated, non-streaming flow when tools are present
    if (hasTools && !stream) {
      // First turn
      const url1 = `${config.openaiBaseUrl}/chat/completions`;
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`,
      };
      const body1 = { ...body, stream: false };
      const r1 = await fetch(url1, { method: 'POST', headers, body: JSON.stringify(body1) });
      const j1 = await r1.json();

      const msg1 = j1?.choices?.[0]?.message;
      const toolCalls = msg1?.tool_calls || [];
      if (!toolCalls.length) {
        // No tool calls; behave like regular non-streaming path
        return res.status(r1.status).json(j1);
      }

      // Execute tools and build follow-up messages
      const toolResults = [];
      for (const tc of toolCalls) {
        const { output } = await executeToolCall(tc);
        toolResults.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: typeof output === 'string' ? output : JSON.stringify(output),
        });
      }

      const messagesFollowUp = [...(bodyIn.messages || []), msg1, ...toolResults];
      const body2 = { model: body.model, messages: messagesFollowUp, stream: false, tools: body.tools, tool_choice: body.tool_choice };
      const r2 = await fetch(url1, { method: 'POST', headers, body: JSON.stringify(body2) });
      const j2 = await r2.json();

      // Persistence for final content
      let finalContent = j2?.choices?.[0]?.message?.content;
      let finalFinish = j2?.choices?.[0]?.finish_reason || null;
      if (persist && assistantMessageId && finalContent) {
        appendAssistantContent({ messageId: assistantMessageId, delta: finalContent });
        finalizeAssistantMessage({ messageId: assistantMessageId, finishReason: finalFinish });
      }
      return res.status(r2.status).json(j2);
    }
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
          return res
            .status(429)
            .json({
              error: 'limit_exceeded',
              message: 'Max messages per conversation reached',
            });
        }

        // Determine next seq for user and assistant
        const userSeq = getNextSeq(conversationId);

        // Persist user message if available
        const msgs = Array.isArray(bodyIn.messages) ? bodyIn.messages : [];
        const lastUser = [...msgs]
          .reverse()
          .find((m) => m && m.role === 'user' && typeof m.content === 'string');
        if (lastUser) {
          insertUserMessage({
            conversationId,
            content: lastUser.content,
            seq: userSeq,
          });
        }
        // Assistant seq right after
        const assistantSeq = userSeq + 1;
        const draft = createAssistantDraft({
          conversationId,
          seq: assistantSeq,
        });
        assistantMessageId = draft.id;
        persist = true;
      }
    }

    const url = useResponsesAPI
      ? `${config.openaiBaseUrl}/responses`
      : `${config.openaiBaseUrl}/chat/completions`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openaiApiKey}`,
    };

    const upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (
      !stream ||
      upstream.headers.get('content-type')?.includes('application/json')
    ) {
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
            object: 'chat.completion',
            created: json.created_at,
            model: json.model,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: content,
                },
                finish_reason: finishReason,
              },
            ],
            usage: json.usage,
          };
        }
      } else if (json?.choices?.[0]?.message?.content) {
        // Chat Completions API format
        content = json.choices[0].message.content;
        finishReason = json.choices[0].finish_reason;
      }

      // If non-streaming and persistence was set up, finalize assistant with full content if present
      if (persist && assistantMessageId && content) {
        appendAssistantContent({
          messageId: assistantMessageId,
          delta: content,
        });
        finalizeAssistantMessage({
          messageId: assistantMessageId,
          finishReason: finishReason || null,
        });
      }
      res.status(upstream.status).json(responseToSend);
      return;
    }

    // Stream (SSE) passthrough or orchestration
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
        try {
          doFlush();
        } catch (e) {
          console.error('[persist] flush error', e);
        }
      }, flushMs);
    }

    let leftover = '';

    // If tools are present, orchestrate with a non-stream first turn, then stream the second turn
    if (hasTools) {
      try {
        // First non-streaming call to collect tool calls
        const url1 = `${config.openaiBaseUrl}/chat/completions`;
        const headers = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.openaiApiKey}`,
        };
        const body1 = { ...body, stream: false };
        const r1 = await fetch(url1, { method: 'POST', headers, body: JSON.stringify(body1) });
        const j1 = await r1.json();
        const msg1 = j1?.choices?.[0]?.message;
        const toolCalls = msg1?.tool_calls || [];

        if (!toolCalls.length && msg1?.content) {
          // No tool calls; synthesize minimal SSE stream for the text content
          const chunk = {
            id: j1.id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: j1.model,
            choices: [{ index: 0, delta: { content: msg1.content }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          // Finish chunk
          const doneChunk = {
            id: j1.id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: j1.model,
            choices: [{ index: 0, delta: {}, finish_reason: j1?.choices?.[0]?.finish_reason || 'stop' }],
          };
          res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
          if (persist && assistantMessageId && msg1.content) {
            buffer += msg1.content;
            doFlush();
            finalizeAssistantMessage({ messageId: assistantMessageId, finishReason: j1?.choices?.[0]?.finish_reason || 'stop', status: 'final' });
          }
          return res.end();
        }

        // Execute tools
        const toolResults = [];
        for (const tc of toolCalls) {
          const { output } = await executeToolCall(tc);
          toolResults.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: typeof output === 'string' ? output : JSON.stringify(output),
          });
        }

        // Second streaming turn
        const messagesFollowUp = [...(bodyIn.messages || []), msg1, ...toolResults];
        const body2 = { model: body.model, messages: messagesFollowUp, stream: true, tools: body.tools, tool_choice: body.tool_choice };
        const r2 = await fetch(url1, { method: 'POST', headers, body: JSON.stringify(body2) });

        r2.body.on('data', (chunk) => {
          try {
            res.write(chunk);
            if (typeof res.flush === 'function') res.flush();
            if (!persist) return;
            const s = String(chunk);
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
                  const delta = obj?.choices?.[0]?.delta?.content;
                  if (delta) {
                    buffer += delta;
                    if (buffer.length >= sizeThreshold) doFlush();
                  }
                  const fr = obj?.choices?.[0]?.finish_reason;
                  if (fr) lastFinishReason = fr;
                } catch {}
              }
            }
          } catch (e) {
            console.error('[orchestrate stream data] error', e);
          }
        });

        r2.body.on('end', () => {
          try {
            if (persist && assistantMessageId) {
              doFlush();
              finalizeAssistantMessage({ messageId: assistantMessageId, finishReason: lastFinishReason || 'stop', status: 'final' });
              if (flushTimer) clearInterval(flushTimer);
            }
          } catch (e) {
            console.error('[persist] finalize error', e);
          }
          return res.end();
        });

        r2.body.on('error', (err) => {
          console.error('Upstream stream error (2nd turn)', err);
          try {
            if (persist && assistantMessageId) {
              doFlush();
              markAssistantError({ messageId: assistantMessageId });
              if (flushTimer) clearInterval(flushTimer);
            }
          } catch {}
          return res.end();
        });

        // Also handle client abort
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
        return; // Orchestrated path handled
      } catch (e) {
        console.error('[orchestrate] error', e);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
    }

    upstream.body.on('data', (chunk) => {
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
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: 'gpt-3.5-turbo',
                      choices: [
                        {
                          index: 0,
                          delta: { content: obj.delta },
                          finish_reason: null,
                        },
                      ],
                    };
                    res.write(
                      `data: ${JSON.stringify(chatCompletionChunk)}\n\n`
                    );

                    // Handle persistence
                    if (persist && obj.delta) {
                      buffer += obj.delta;
                      if (buffer.length >= sizeThreshold) doFlush();
                    }
                  } else if (obj.type === 'response.completed') {
                    const chatCompletionChunk = {
                      id: obj.response.id,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: obj.response.model,
                      choices: [
                        {
                          index: 0,
                          delta: {},
                          finish_reason: 'stop',
                        },
                      ],
                    };
                    res.write(
                      `data: ${JSON.stringify(chatCompletionChunk)}\n\n`
                    );
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

                if (
                  useResponsesAPI &&
                  obj.type === 'response.output_text.delta'
                ) {
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
          finalizeAssistantMessage({
            messageId: assistantMessageId,
            finishReason: lastFinishReason || null,
            status: 'final',
          });
          if (flushTimer) clearInterval(flushTimer);
        }
      } catch (e) {
        console.error('[persist] finalize error', e);
      }
      res.end();
    });

    upstream.body.on('error', (err) => {
      console.error('Upstream stream error', err);
      try {
        if (persist && assistantMessageId) {
          doFlush();
          markAssistantError({ messageId: assistantMessageId });
          if (flushTimer) clearInterval(flushTimer);
        }
      } catch {
        // Client disconnected; ignore
      }
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
      } catch {
        // Client disconnected; ignore
      }
    });
  } catch (e) {
    console.error('[proxy] error', e);
    // On synchronous error finalize as error
    try {
      if (persist && assistantMessageId) {
        markAssistantError({ messageId: assistantMessageId });
      }
    } catch {
        // Client disconnected; ignore
      }
    res.status(500).json({ error: 'upstream_error', message: e.message });
  }
}
