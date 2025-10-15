import { config } from '../env.js';
import { generateOpenAIToolSpecs, generateToolSpecs } from './tools.js';
import { handleToolsJson } from './toolsJson.js';
import { handleToolsStreaming } from './toolsStreaming.js';
import { handleRegularStreaming } from './streamingHandler.js';
import { setupStreamingHeaders, createOpenAIRequest } from './streamUtils.js';
import { createProvider } from './providers/index.js';
import { SimplifiedPersistence } from './simplifiedPersistence.js';
import { addConversationMetadata, getConversationMetadata } from './responseUtils.js';
import { logger } from '../logger.js';
import { addPromptCaching } from './promptCaching.js';

// --- Constants ---

// --- Helpers: sanitize, validate, selection, and error shaping ---

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
  const stream = body.stream !== false;
  const providerStream = body.provider_stream !== false;
  return { hasTools, stream, providerStream };
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

  const body = await sanitizeIncomingBody(bodyIn, {
    toolSpecs,
    conversationId,
    userId,
    sessionId
  });

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
    sessionId
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

async function handleUpstreamError(upstream, persistence) {
  const upstreamBody = await readUpstreamError(upstream);
  if (persistence.persist) persistence.markError();

  const upstreamMessage = typeof upstreamBody === 'string'
    ? upstreamBody
    : (typeof upstreamBody?.message === 'string'
      ? upstreamBody.message
      : (typeof upstreamBody?.error === 'string' ? upstreamBody.error : undefined));

  logger.warn({
    msg: 'upstream_error_response',
    upstreamStatus: upstream.status,
    upstreamMessage,
  });

  const payload = {
    error: 'upstream_error',
    message: 'Upstream provider returned an error response.',
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
  const { body, bodyIn, flags, provider, providerId, persistence, userId } = context;
  const upstreamStreamEnabled = flags.providerStream !== false;

  if (flags.hasTools) {
    // Tool orchestration path
    if (flags.stream) {
      return handleToolsStreaming({ body, bodyIn, config, res, req, persistence, provider, userId });
    } else {
      return handleToolsJson({ body, bodyIn, config, res, req, persistence, provider, userId });
    }
  }

  // Plain proxy path

  // Try to use previous_response_id optimization for existing conversations
  let requestBody = { ...body };
  requestBody.stream = upstreamStreamEnabled;
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

  const upstream = await createOpenAIRequest(config, requestBody, { providerId });
  if (!upstream.ok) {
    const { status, payload } = await handleUpstreamError(upstream, persistence);
    return res.status(status).json(payload);
  }

  if (flags.stream) {
    // Streaming response expected
    // Check if upstream actually returned a stream or a JSON response
    const contentType = upstream.headers?.get?.('content-type') || '';
    const isStreamResponse = contentType.includes('text/event-stream') || contentType.includes('text/plain');

    if (!isStreamResponse) {
      // Upstream returned JSON instead of stream - convert it to streaming format
      try {
        const upstreamJson = await upstream.json();

        // Persist the response
        if (persistence.persist && upstreamJson.choices?.[0]?.message) {
          const message = upstreamJson.choices[0].message;
          if (message.content !== undefined) {
            persistence.setAssistantContent(message.content);
          }
          if (Array.isArray(message.reasoning_details)) {
            persistence.setReasoningDetails(message.reasoning_details);
          }
          if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
            const contentLength = message.content ?
              (typeof message.content === 'string' ? message.content.length : 0) : 0;
            const toolCallsWithOffset = message.tool_calls.map((tc, idx) => ({
              ...tc,
              index: tc.index ?? idx,
              textOffset: contentLength
            }));
            persistence.addToolCalls(toolCallsWithOffset);
          }

          const finishReason = upstreamJson.choices[0].finish_reason || null;
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
        const message = upstreamJson.choices[0]?.message;
        if (message) {
          const { createChatCompletionChunk } = await import('./streamUtils.js');

          // Send content as chunk if present
          if (message.content) {
            const chunk = createChatCompletionChunk(
              upstreamJson.id || 'fallback',
              upstreamJson.model || body.model,
              { role: 'assistant', content: message.content },
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
            upstreamJson.choices[0].finish_reason || 'stop'
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
    return handleRegularStreaming({ config, upstream, res, req, persistence });
  } else {
    // JSON response
    const upstreamJson = await upstream.json();

    if (persistence.persist) {
      let content = '';
      let finishReason = null;
      let responseId = null;

      let contentHandled = false;

      if (upstreamJson.choices && upstreamJson.choices[0] && upstreamJson.choices[0].message) {
        content = upstreamJson.choices[0].message.content;
        if (persistence.persist) {
          const message = upstreamJson.choices[0].message;
          if (message.content !== undefined) {
            persistence.setAssistantContent(message.content);
            contentHandled = true;
          }
          if (Array.isArray(message.reasoning_details)) {
            persistence.setReasoningDetails(message.reasoning_details);
          }
          // Capture tool_calls from message
          if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
            logger.debug('[openaiProxy] Capturing tool calls from JSON response', {
              count: message.tool_calls.length,
              callIds: message.tool_calls.map(tc => tc?.id)
            });

            // For non-streaming responses, set textOffset based on whether there's content
            // If there's content, assume tools appear at the end (common pattern)
            // If no content, tools appear at position 0
            const contentLength = message.content ?
              (typeof message.content === 'string' ? message.content.length : 0) : 0;

            const toolCallsWithOffset = message.tool_calls.map((tc, idx) => ({
              ...tc,
              index: tc.index ?? idx,
              textOffset: contentLength
            }));

            persistence.addToolCalls(toolCallsWithOffset);
          }
        }
      }
      finishReason = upstreamJson.choices && upstreamJson.choices[0]
        ? upstreamJson.choices[0].finish_reason
        : null;

      // Capture response_id from OpenAI for conversation state management
      responseId = upstreamJson.id || null;

      if (content && persistence.persist && !contentHandled) {
        persistence.setAssistantContent(content);
      }
      if (persistence.persist) {
        const reasoningTokens = upstreamJson?.usage?.reasoning_tokens
          ?? upstreamJson?.usage?.completion_tokens_details?.reasoning_tokens
          ?? upstreamJson?.usage?.reasoning_token_count
          ?? null;
        if (reasoningTokens != null) {
          persistence.setReasoningTokens(reasoningTokens);
        }
      }
      persistence.recordAssistantFinal({ finishReason, responseId });
    }

    const responseBody = { ...upstreamJson };
    addConversationMetadata(responseBody, persistence);
    return res.status(200).json(responseBody);
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
  const contextWithPersistence = { ...context, persistence };

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
