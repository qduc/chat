import { config } from '../env.js';
import { generateOpenAIToolSpecs, generateToolSpecs } from './tools.js';
import { handleToolsJson } from './toolsJson.js';
import { handleToolsStreaming } from './toolsStreaming.js';
import { handleRegularStreaming } from './streamingHandler.js';
import { setupStreamingHeaders, createOpenAIRequest } from './streamUtils.js';
import { extractUsage } from './utils/usage.js';
import { createProvider } from './providers/index.js';
import { SimplifiedPersistence } from './simplifiedPersistence.js';
import { addConversationMetadata, getConversationMetadata } from './responseUtils.js';
import { logger } from '../logger.js';
import { addPromptCaching } from './promptCaching.js';
import { registerStreamAbort, unregisterStreamAbort } from './streamAbortRegistry.js';
import { isAbortError } from './abortUtils.js';
import { getUserSetting } from '../db/userSettings.js';
import { normalizeCustomRequestParamsIds } from './customRequestParams.js';

// --- Helpers: sanitize, validate, selection, and error shaping ---

function sanitizeContent(content) {
  if (typeof content === 'string' || Array.isArray(content)) return content;
  if (content === null || content === undefined) return '';
  return String(content);
}

async function sanitizeIncomingBody(bodyIn, helpers = {}) {
  const body = { ...bodyIn };
  const providerStreamInput = typeof bodyIn.provider_stream === 'boolean'
    ? bodyIn.provider_stream
    : (typeof bodyIn.providerStream === 'boolean' ? bodyIn.providerStream : undefined);

  // Normalize incoming system prompt
  const rawSystemPrompt = typeof bodyIn.system_prompt === 'string'
    ? bodyIn.system_prompt.trim()
    : '';

  // Inject system prompt as leading system message
  try {
    if (rawSystemPrompt) {
      const systemMsg = { role: 'system', content: rawSystemPrompt };
      if (!Array.isArray(body.messages)) body.messages = [];
      if (body.messages.length > 0 && body.messages[0] && body.messages[0].role === 'system') {
        // Replace existing first system message to avoid duplicates
        body.messages[0] = systemMsg;
      } else {
        body.messages.unshift(systemMsg);
      }
    }
  } catch {
    // ignore mapping errors
  }
  // Strip non-upstream fields
  delete body.conversation_id;
  delete body.provider_id; // frontend-selected provider (handled server-side only)
  delete body.provider; // internal provider selection field
  delete body.streamingEnabled;
  delete body.toolsEnabled;
  delete body.researchMode;
  delete body.qualityLevel;
  delete body.system_prompt;
  delete body.providerStream;
  delete body.client_request_id;
  delete body.custom_request_params_id;
  delete body.custom_request_params;

  if (providerStreamInput !== undefined) {
    body.provider_stream = providerStreamInput;
  } else if (typeof body.stream !== 'undefined') {
    body.provider_stream = body.stream;
  }
  // Default model
  // Default model is resolved later (may come from DB)

  // Allow a simplified tools representation from frontend: an array of tool names (strings).
  // Expand into full OpenAI-compatible tool specs using server-side registry.
  try {
    if (Array.isArray(bodyIn.tools) && bodyIn.tools.length > 0 && typeof bodyIn.tools[0] === 'string') {
      const toolSpecs = Array.isArray(helpers.toolSpecs) && helpers.toolSpecs.length > 0
        ? helpers.toolSpecs
        : generateOpenAIToolSpecs();
      const selected = toolSpecs.filter((spec) => bodyIn.tools.includes(spec.function?.name));
      body.tools = selected;
    }
  } catch {
    // ignore expansion errors and let downstream validation handle unexpected shapes
  }
  return body;
}

function normalizeCustomRequestParams(raw) {
  if (!raw) return [];
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const label = typeof item.label === 'string' ? item.label.trim() : '';
      const id = typeof item.id === 'string' && item.id.trim()
        ? item.id.trim()
        : label || `preset-${index + 1}`;
      const params = item.params;
      return {
        id,
        label: label || id,
        params,
      };
    })
    .filter(Boolean);
}

function resolveCustomRequestParams({ userId, customRequestParamsIds }) {
  if (!userId || !Array.isArray(customRequestParamsIds) || customRequestParamsIds.length === 0) {
    return null;
  }
  const setting = getUserSetting(userId, 'custom_request_params');
  if (!setting?.value) return null;
  const presets = normalizeCustomRequestParams(setting.value);
  const mergedParams = {};
  for (const id of customRequestParamsIds) {
    const match = presets.find((preset) => preset.id === id || preset.label === id);
    if (!match || !match.params) continue;
    if (typeof match.params !== 'object' || Array.isArray(match.params)) continue;
    Object.assign(mergedParams, match.params);
  }
  return Object.keys(mergedParams).length > 0 ? mergedParams : null;
}

function validateAndNormalizeReasoningControls(body, { reasoningAllowed }) {
  // Only allow reasoning controls if provider+model supports it
  const isAllowed = !!reasoningAllowed;

  // Validate and handle reasoning_effort
  if (body.reasoning_effort) {
    if (!isAllowed) {
      delete body.reasoning_effort;
    } else {
      const allowedEfforts = ['minimal', 'low', 'medium', 'high'];
      if (!allowedEfforts.includes(body.reasoning_effort)) {
        return {
          ok: false,
          status: 400,
          payload: {
            error: 'invalid_request_error',
            message: `Invalid reasoning_effort. Must be one of ${allowedEfforts.join(', ')}`,
          },
        };
      }
    }
  }

  // Validate and handle verbosity
  if (body.verbosity) {
    if (!isAllowed) {
      delete body.verbosity;
    } else {
      const allowedVerbosity = ['low', 'medium', 'high'];
      if (!allowedVerbosity.includes(body.verbosity)) {
        return {
          ok: false,
          status: 400,
          payload: {
            error: 'invalid_request_error',
            message: `Invalid verbosity. Must be one of ${allowedVerbosity.join(', ')}`,
          },
        };
      }
    }
  }

  return { ok: true };
}

function getFlags({ body, provider }) {
  const hasTools = provider.supportsTools() && Array.isArray(body.tools) && body.tools.length > 0;

  // If stream was explicitly set to false, honor it (for backward compatibility and tests)
  // Otherwise, default to true for frontend SSE
  const streamToFrontend = body.stream !== false;

  // Upstream streaming is controlled by provider_stream flag
  const providerStream = body.provider_stream !== false;

  return { hasTools, streamToFrontend, providerStream };
}


async function readUpstreamError(upstream) {
  try {
    return await upstream.json();
  } catch {
    try {
      const text = await upstream.text();
      return { error: 'upstream_error', message: text };
    } catch {
      return { error: 'upstream_error', message: 'Unknown error' };
    }
  }
}

// --- Request Context Building ---

async function buildRequestContext(req) {
  const bodyIn = req.body || {};
  const providerId = bodyIn.provider_id || req.header('x-provider-id') || undefined;
  const provider = await createProvider(config, { providerId });

  const toolSpecs = provider.getToolsetSpec({
    generateOpenAIToolSpecs,
    generateToolSpecs,
  }) || [];

  const conversationId = bodyIn.conversation_id || req.header('x-conversation-id');
  const userId = req.user.id; // Guaranteed by authenticateToken middleware
  const sessionId = req.sessionId || null;
  const clientRequestId = req.header('x-client-request-id') || bodyIn.client_request_id || null;

  const body = await sanitizeIncomingBody(bodyIn, {
    toolSpecs,
    conversationId,
    userId,
    sessionId
  });

  const customRequestParamsIds = Object.hasOwn(bodyIn, 'custom_request_params_id')
    ? normalizeCustomRequestParamsIds(bodyIn.custom_request_params_id)
    : undefined;

  if (Array.isArray(customRequestParamsIds) && customRequestParamsIds.length > 0) {
    const customParams = resolveCustomRequestParams({ userId, customRequestParamsIds });
    if (customParams) {
      body.custom_request_params = customParams;
    }
  }

  // Resolve default model from DB-backed provider settings when missing
  if (!body.model) {
    body.model = provider.getDefaultModel();
  }

  const flags = getFlags({ body, provider });

  return {
    bodyIn,
    body,
    provider,
    providerId,
    conversationId,
    userId,
    flags,
    toolSpecs,
    sessionId,
    clientRequestId,
  };
}

// --- Request Validation ---

async function validateRequestContext(context, req) {
  const { body, provider } = context;

  // Validate reasoning controls early and return guard failures
  const validation = validateAndNormalizeReasoningControls(body, {
    reasoningAllowed: provider.supportsReasoningControls(body.model),
  });

  if (!validation.ok) {
    logger.error({
      msg: 'validation_error',
      error: {
        message: validation.payload.message,
        type: validation.payload.error,
      },
      req: {
        id: req.id,
        method: req.method,
        url: req.url,
        body: req.body,
      },
      validation: {
        status: validation.status,
        payload: validation.payload,
      },
      validationFailure: `${validation.payload.error}: ${validation.payload.message}`,
    });
  }

  return validation;
}

// --- Error Handling Helpers ---

function handleValidationError(res, validation) {
  return res.status(validation.status).json(validation.payload);
}

/**
 * Extract a human-readable error message from various upstream response formats.
 * Handles OpenAI, Anthropic, Gemini, and other provider error structures.
 */
function extractUpstreamMessage(body) {
  if (typeof body === 'string') {
    return body;
  }
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  // Direct message field (OpenAI style)
  if (typeof body.message === 'string') {
    return body.message;
  }

  // Direct error string
  if (typeof body.error === 'string') {
    return body.error;
  }

  // Nested error object with message (Anthropic/OpenAI style)
  if (body.error && typeof body.error === 'object' && typeof body.error.message === 'string') {
    return body.error.message;
  }

  // Array of errors (Gemini style: [{error: {message: "..."}}])
  if (Array.isArray(body) && body.length > 0) {
    const first = body[0];
    if (first && typeof first === 'object') {
      if (typeof first.message === 'string') {
        return first.message;
      }
      if (first.error && typeof first.error === 'object' && typeof first.error.message === 'string') {
        return first.error.message;
      }
    }
  }

  return undefined;
}

async function handleUpstreamError(upstream, persistence) {
  const upstreamBody = await readUpstreamError(upstream);
  if (persistence.persist) persistence.markError();

  const upstreamMessage = extractUpstreamMessage(upstreamBody);

  logger.warn({
    msg: 'upstream_error_response',
    upstreamStatus: upstream.status,
    upstreamMessage,
  });

  // Use the extracted upstream message as the primary message if available
  const displayMessage = upstreamMessage || 'Upstream provider returned an error response.';

  const payload = {
    error: 'upstream_error',
    message: displayMessage,
    upstream: {
      status: upstream.status,
      ...(upstreamMessage ? { message: upstreamMessage } : {}),
      body: upstreamBody,
    },
  };

  return { status: 502, payload };
}

function handleProxyError(error, req, res, persistence) {
  logger.error({
    msg: 'proxy_error',
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name,
    },
    req: {
      id: req.id,
      method: req.method,
      url: req.url,
      body: req.body,
    },
    proxyError: `${error.name}: ${error.message}`,
  });
  if (persistence && persistence.persist) {
    persistence.markError();
  }
  return res.status(500).json({ error: 'upstream_error', message: error.message });
}

// --- Handler Execution ---

async function handleRequest(context, req, res) {
  const { body, bodyIn, flags, provider, providerId, persistence, userId, abortContext } = context;

  if (bodyIn?.parent_conversation_id && Array.isArray(bodyIn.messages)) {
    const summarized = bodyIn.messages.map((msg) => ({
      role: msg?.role,
      id: msg?.id,
      contentLen:
        typeof msg?.content === 'string'
          ? msg.content.length
          : Array.isArray(msg?.content)
            ? msg.content.length
            : 0,
    }));
    logger.debug('[openaiProxy] comparison request message history', {
      parentConversationId: bodyIn.parent_conversation_id,
      count: summarized.length,
      summary: summarized,
    });
  }

  if (flags.hasTools) {
    // Tool orchestration path
    if (flags.streamToFrontend) {
      return handleToolsStreaming({ body, bodyIn, config, res, req, persistence, provider, userId, abortContext });
    } else {
      return handleToolsJson({ body, bodyIn, config, res, req, persistence, provider, userId, abortContext });
    }
  }

  // Plain proxy path

  // Try to use previous_response_id optimization for existing conversations
  let requestBody = { ...body };
  requestBody.stream = flags.providerStream;
  delete requestBody.provider_stream;
  delete requestBody.providerStream;
  if (persistence && persistence.persist && persistence.conversationId) {
    const { buildConversationMessagesOptimized } = await import('./toolOrchestrationUtils.js');
    const { messages, previousResponseId } = await buildConversationMessagesOptimized({
      body,
      bodyIn,
      persistence,
      userId,
      provider
    });
    requestBody.messages = messages;
    // previousResponseId is already validated inside buildConversationMessagesOptimized
    // It will only be returned if it's valid (starts with 'resp_')
    if (previousResponseId) {
      requestBody.previous_response_id = previousResponseId;
    }
  }

  // Apply prompt caching after messages are fully constructed
  requestBody = await addPromptCaching(requestBody, {
    conversationId: persistence?.conversationId,
    userId,
    provider,
    hasTools: false
  });

  let upstream;
  try {
    upstream = await createOpenAIRequest(config, requestBody, { providerId, signal: abortContext?.signal });
  } catch (error) {
    if (abortContext?.requestId) {
      unregisterStreamAbort(abortContext.requestId);
    }
    if (abortContext?.cancelState?.cancelled || isAbortError(error)) {
      if (persistence && persistence.persist) {
        persistence.recordAssistantFinal({ finishReason: 'cancelled' });
      }
      if (!res.writableEnded) res.end();
      return;
    }
    throw error;
  }

  // If request with previous_response_id failed due to invalid ID format, retry with full history
  if (!upstream.ok && requestBody.previous_response_id) {
    const upstreamBody = await readUpstreamError(upstream);
    const isInvalidResponseIdError = upstream.status === 400
      && upstreamBody?.error?.param === 'previous_response_id'
      && upstreamBody?.error?.code === 'invalid_value';

    if (isInvalidResponseIdError) {
      logger.warn({
        msg: 'invalid_previous_response_id',
        previous_response_id: requestBody.previous_response_id,
        error: upstreamBody?.error?.message,
        retrying: 'with full history'
      });

      // Retry without previous_response_id (will use full history)
      const retryBody = { ...requestBody };
      delete retryBody.previous_response_id;

      // Rebuild full message history
      if (persistence && persistence.persist && persistence.conversationId) {
        const { buildConversationMessagesAsync } = await import('./toolOrchestrationUtils.js');
        const fullMessages = await buildConversationMessagesAsync({
          body,
          bodyIn,
          persistence,
          userId
        });
        retryBody.messages = fullMessages;
      }

      // Reapply prompt caching with full history
      const retryBodyWithCaching = await addPromptCaching(retryBody, {
        conversationId: persistence?.conversationId,
        userId,
        provider,
        hasTools: false
      });

      try {
        upstream = await createOpenAIRequest(config, retryBodyWithCaching, { providerId, signal: abortContext?.signal });
      } catch (error) {
        if (abortContext?.requestId) {
          unregisterStreamAbort(abortContext.requestId);
        }
        throw error;
      }
    }
  }

  if (!upstream.ok) {
    const { status, payload } = await handleUpstreamError(upstream, persistence);
    return res.status(status).json(payload);
  }

  if (flags.streamToFrontend) {
    // Always stream to frontend (for consistent SSE protocol)
    // Always stream to frontend (for consistent SSE protocol)
    // Check if upstream actually returned a stream or a JSON response
    const contentType = upstream.headers?.get?.('content-type') || '';
    const isStreamResponse = contentType.includes('text/event-stream') || contentType.includes('text/plain');

    if (!isStreamResponse) {
      // Upstream returned JSON instead of stream - convert it to streaming format
      try {
        const upstreamJson = await upstream.json();
        const normalizedUsage = extractUsage(upstreamJson);
        if (normalizedUsage) {
          persistence?.setUsage?.(normalizedUsage);
        }

        if (upstreamJson.provider && persistence && typeof persistence.setProvider === 'function') {
          persistence.setProvider(upstreamJson.provider);
        }

        // Persist the response
        if (persistence.persist && upstreamJson.choices?.[0]?.message) {
          const message = upstreamJson.choices?.[0]?.message;
          if (message.content !== undefined) {
            const safeContent = sanitizeContent(message.content);
            persistence.setAssistantContent(safeContent);
            if (typeof persistence.addMessageEvent === 'function') {
              const contentText = Array.isArray(safeContent)
                ? safeContent
                  .map((part) => {
                    if (typeof part === 'string') return part;
                    if (part && typeof part === 'object') {
                      if (typeof part.text === 'string') return part.text;
                      if (typeof part.value === 'string') return part.value;
                      if (typeof part.content === 'string') return part.content;
                    }
                    return '';
                  })
                  .join('')
                : (typeof safeContent === 'string' ? safeContent : '');
              if (contentText) {
                persistence.addMessageEvent('content', { text: contentText });
              }
            }
          }
          if (Array.isArray(message.reasoning_details)) {
            persistence.setReasoningDetails(message.reasoning_details);
            if (typeof persistence.addMessageEvent === 'function') {
              const reasoningText = message.reasoning_details
                .map((detail) => (typeof detail?.text === 'string' ? detail.text.trim() : ''))
                .filter(Boolean)
                .join('\n\n');
              if (reasoningText) {
                persistence.addMessageEvent('reasoning', { text: reasoningText });
              }
            }
          }
          if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
            const safeContent = sanitizeContent(message.content);
            const contentLength = safeContent ?
              (typeof safeContent === 'string' ? safeContent.length : 0) : 0;
            const toolCallsWithOffset = message.tool_calls.map((tc, idx) => ({
              ...tc,
              index: tc.index ?? idx,
              textOffset: contentLength
            }));
            persistence.addToolCalls(toolCallsWithOffset);
            if (typeof persistence.addMessageEvent === 'function') {
              for (const tc of toolCallsWithOffset) {
                persistence.addMessageEvent('tool_call', {
                  tool_call_id: tc.id ?? null,
                  tool_call_index: tc.index ?? null,
                });
              }
            }
          }

          const finishReason = upstreamJson.choices?.[0]?.finish_reason || null;
          const responseId = upstreamJson.id || null;

          const reasoningTokens = upstreamJson?.usage?.reasoning_tokens
            ?? upstreamJson?.usage?.completion_tokens_details?.reasoning_tokens
            ?? upstreamJson?.usage?.reasoning_token_count
            ?? null;
          if (reasoningTokens != null) {
            persistence.setReasoningTokens(reasoningTokens);
          }

          persistence.recordAssistantFinal({ finishReason, responseId });
        }

        // Convert JSON response to streaming format for client
        setupStreamingHeaders(res);
        const { writeAndFlush } = await import('./streamUtils.js');

        // Emit conversation metadata if available
        const conversationMeta = getConversationMetadata(persistence);
        if (conversationMeta) {
          writeAndFlush(res, `data: ${JSON.stringify(conversationMeta)}\n\n`);
        }

        // Convert to streaming chunks
        const message = upstreamJson.choices?.[0]?.message;
        if (message) {
          const { createChatCompletionChunk } = await import('./streamUtils.js');

          // Send content as chunk if present
          if (message.content !== undefined) {
            const safeContent = sanitizeContent(message.content);
            const chunk = createChatCompletionChunk(
              upstreamJson.id || 'fallback',
              upstreamJson.model || body.model,
              { role: 'assistant', content: safeContent },
              null
            );
            writeAndFlush(res, `data: ${JSON.stringify(chunk)}\n\n`);
          }

          // Send tool calls as chunks if present
          if (Array.isArray(message.tool_calls)) {
            for (const toolCall of message.tool_calls) {
              const chunk = createChatCompletionChunk(
                upstreamJson.id || 'fallback',
                upstreamJson.model || body.model,
                { tool_calls: [toolCall] },
                null
              );
              writeAndFlush(res, `data: ${JSON.stringify(chunk)}\n\n`);
            }
          }

          // Send final chunk with finish_reason
          const finalChunk = createChatCompletionChunk(
            upstreamJson.id || 'fallback',
            upstreamJson.model || body.model,
            {},
            upstreamJson.choices?.[0]?.finish_reason || 'stop'
          );
          writeAndFlush(res, `data: ${JSON.stringify(finalChunk)}\n\n`);
        }

        // Send [DONE]
        writeAndFlush(res, 'data: [DONE]\n\n');
        return res.end();
      } catch (conversionError) {
        logger.error({
          msg: 'stream_conversion_error',
          error: {
            message: conversionError.message,
            stack: conversionError.stack,
          },
        });

        // Fall back to error chunk
        setupStreamingHeaders(res);
        const { writeAndFlush } = await import('./streamUtils.js');
        const errorChunk = {
          id: 'error',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [{
            index: 0,
            delta: { content: `[Error converting response: ${conversionError.message}]` },
            finish_reason: 'error'
          }]
        };
        writeAndFlush(res, `data: ${JSON.stringify(errorChunk)}\n\n`);
        writeAndFlush(res, 'data: [DONE]\n\n');
        return res.end();
      }
    }

    // Normal streaming response
    setupStreamingHeaders(res);
    return handleRegularStreaming({
      config,
      upstream,
      res,
      req,
      persistence,
      provider,
      abortContext,
      onComplete: () => {
        if (abortContext?.requestId) {
          unregisterStreamAbort(abortContext.requestId);
        }
      },
    });
  } else {
    // JSON response (for backward compatibility and when explicitly requested)
    try {
      const responseBody = await upstream.json();
      if (responseBody.provider && persistence && typeof persistence.setProvider === 'function') {
        persistence.setProvider(responseBody.provider);
      }
      addConversationMetadata(responseBody, persistence);
      return res.status(200).json(responseBody);
    } catch (err) {
      return res.status(500).json({ error: 'upstream_json_error', message: err?.message });
    }
  }
}

async function executeRequestHandler(context, req, res) {
  // Persistence setup
  const persistence = new SimplifiedPersistence(config);
  const sessionId = req.sessionId;
  const userId = context.userId; // Use userId from context

  const initResult = await persistence.initialize({
    conversationId: context.conversationId,
    sessionId,
    userId, // Pass user context to persistence
    req,
    bodyIn: context.bodyIn
  });

  // Handle persistence validation errors
  if (initResult.error) {
    return res.status(initResult.error.statusCode).json({
      error: initResult.error.type,
      message: initResult.error.message,
      details: initResult.error.details,
    });
  }

  // Add persistence to context for the unified handler
  let abortContext = null;
  if (context.clientRequestId && context.flags.streamToFrontend) {
    const controller = new AbortController();
    const cancelState = { cancelled: false };
    registerStreamAbort(context.clientRequestId, {
      controller,
      cancelState,
      userId,
    });
    abortContext = {
      requestId: context.clientRequestId,
      signal: controller.signal,
      cancelState,
    };
  }

  const contextWithPersistence = { ...context, persistence, abortContext };

  try {
    const result = await handleRequest(contextWithPersistence, req, res);

    // After successful response, update usage tracking for system prompts
    if (userId && context.conversationId && persistence.persist) {
      try {
        const { updateUsageAfterSend } = await import('./promptService.js');
        const inlineOverride = null; // No longer sending inline override separately
        await updateUsageAfterSend(
          context.conversationId,
          { userId, sessionId: context.sessionId || null },
          inlineOverride
        );
      } catch (error) {
        // Don't fail the request if usage tracking fails
        logger.warn('[openaiProxy] Failed to update prompt usage:', error.message);
      }
    }

    return result;
  } finally {
    if (abortContext?.requestId && context.flags.hasTools) {
      unregisterStreamAbort(abortContext.requestId);
    }
    if (persistence) {
      persistence.cleanup();
    }
  }
}

export async function proxyOpenAIRequest(req, res) {
  let context;
  try {
    context = await buildRequestContext(req);
    const validation = await validateRequestContext(context, req);
    if (!validation.ok) return handleValidationError(res, validation);

    return await executeRequestHandler(context, req, res);
  } catch (error) {
    return handleProxyError(error, req, res, context?.persistence);
  } finally {
    // Persistence cleanup is handled within executeRequestHandler
  }
}
