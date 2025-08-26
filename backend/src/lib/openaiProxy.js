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
  
  // Setup persistence buffer variables for tool orchestration
  let buffer = { value: '' };
  let flushedOnce = { value: false };
  const sizeThreshold = 100;
  const flushMs = 1000;
  let flushTimer = null;
  
  try {
    // Setup persistence
    const persistenceResult = await setupPersistence({
      conversationId,
      sessionId,
      req,
      res,
      bodyIn,
    });
    
    if (persistenceResult?.messageLimitExceeded) {
      return; // Response already sent
    }
    
    persist = persistenceResult?.persist || false;
    assistantMessageId = persistenceResult?.assistantMessageId || null;

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
      ? `${config.openaiBaseUrl}/v1/responses`
      : `${config.openaiBaseUrl}/v1/chat/completions`;
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
    if (!upstream.ok || !stream) {
      const result = await handleNonStreamingPersistence({
        upstream,
        req,
        useResponsesAPI,
        persist,
        assistantMessageId,
        finalizeAssistantMessage,
        markAssistantError,
      });
      return res.status(result.status).json(result.response);
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
    
  } catch (error) {
    console.error('[proxy] error', error);
    if (persist && assistantMessageId) {
      markAssistantError({ messageId: assistantMessageId });
    }
    res.status(500).json({ 
      error: 'upstream_error', 
      message: error.message 
    });
  } finally {
    cleanupPersistenceTimer(flushTimer);
  }
}
