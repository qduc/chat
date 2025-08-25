import fetch from 'node-fetch';
import { config } from '../env.js';
import { handleUnifiedToolOrchestration } from './unifiedToolOrchestrator.js';
import {
  setupStreamingHeaders,
  handleRegularStreaming,
} from './streamingHandler.js';
import {
  setupPersistence,
  setupPersistenceTimer,
  handleNonStreamingPersistence,
  cleanupPersistenceTimer,
  appendAssistantContent,
  finalizeAssistantMessage,
  markAssistantError,
} from './persistenceHandler.js';

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

  // Validate and handle reasoning_effort
  if (body.reasoning_effort) {
    const allowedEfforts = ['minimal', 'low', 'medium', 'high'];
    if (!allowedEfforts.includes(body.reasoning_effort)) {
      return res.status(400).json({
        error: 'invalid_request_error',
        message: `Invalid reasoning_effort. Must be one of ${allowedEfforts.join(
          ', '
        )}`,
      });
    }
  }

  // Validate and handle verbosity
  if (body.verbosity) {
    const allowedVerbosity = ['low', 'medium', 'high'];
    if (!allowedVerbosity.includes(body.verbosity)) {
      return res.status(400).json({
        error: 'invalid_request_error',
        message: `Invalid verbosity. Must be one of ${allowedVerbosity.join(
          ', '
        )}`,
      });
    }
  }
  
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

  // Persistence state
  let persist = false;
  let assistantMessageId = null;
  const sessionId = req.sessionId;
  const buffer = { value: '' };
  const flushedOnce = { value: false };
  let flushTimer = null;

  const sizeThreshold = 512;
  const flushMs = config.persistence.historyBatchFlushMs;

  try {
    // Setup persistence if enabled
    try {
      const persistenceResult = await setupPersistence({
        config,
        conversationId,
        sessionId,
        req,
        res,
        bodyIn,
      });
      persist = persistenceResult.persist;
      assistantMessageId = persistenceResult.assistantMessageId;
    } catch (error) {
      if (error.message === 'Message limit exceeded') {
        return; // Response already sent
      }
      throw error;
    }

    // Handle tool orchestration (unified for streaming and non-streaming)
    if (hasTools) {
      return await handleUnifiedToolOrchestration({
        body,
        bodyIn,
        config,
        res,
        req,
        persist,
        assistantMessageId,
        appendAssistantContent,
        finalizeAssistantMessage,
        markAssistantError,
        buffer,
        flushedOnce,
        sizeThreshold,
      });
    }

    // Make upstream request
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

    // Handle non-streaming responses
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

      // Handle persistence for non-streaming responses
      handleNonStreamingPersistence({
        persist,
        assistantMessageId,
        content,
        finishReason,
      });

      return res.status(upstream.status).json(responseToSend);
    }

    // Setup streaming headers
    setupStreamingHeaders(res);

    // Setup persistence timer
    flushTimer = setupPersistenceTimer({
      persist,
      flushMs,
      doFlush: () => {
        if (!persist || !assistantMessageId) return;
        if (buffer.value.length === 0) return;
        appendAssistantContent({
          messageId: assistantMessageId,
          delta: buffer.value,
        });
        buffer.value = '';
        flushedOnce.value = true;
      },
    });

    // Tool orchestration is already handled above before reaching this point

    // Handle regular streaming (non-tool orchestration)
    return await handleRegularStreaming({
      upstream,
      res,
      req,
      persist,
      assistantMessageId,
      appendAssistantContent,
      finalizeAssistantMessage,
      markAssistantError,
      buffer,
      flushedOnce,
      sizeThreshold,
      useResponsesAPI,
    });
  } catch (e) {
    console.error('[proxy] error', e);
    // Cleanup persistence timer on error
    cleanupPersistenceTimer(flushTimer);
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
