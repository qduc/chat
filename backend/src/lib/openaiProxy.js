import { config } from '../env.js';
import { generateOpenAIToolSpecs, generateToolSpecs } from './tools.js';
import { handleToolsJson } from './toolsJson.js';
import { handleToolsStreaming } from './toolsStreaming.js';
import { handleRegularStreaming } from './streamingHandler.js';
import { setupStreamingHeaders, createOpenAIRequest } from './streamUtils.js';
import { createProvider } from './providers/index.js';
import { SimplifiedPersistence } from './simplifiedPersistence.js';
import { addConversationMetadata } from './responseUtils.js';
import { logger } from '../logger.js';

// --- Constants ---

// --- Helpers: sanitize, validate, selection, and error shaping ---

async function sanitizeIncomingBody(bodyIn, helpers = {}) {
  const body = { ...bodyIn };

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
  const stream = !!body.stream;
  return { hasTools, stream };
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
  const errorJson = await readUpstreamError(upstream);
  if (persistence.persist) persistence.markError();
  return { status: upstream.status, errorJson };
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

  const upstream = await createOpenAIRequest(config, requestBody, { providerId });
  if (!upstream.ok) {
    const { status, errorJson } = await handleUpstreamError(upstream, persistence);
    return res.status(status).json(errorJson);
  }

  if (flags.stream) {
    // Streaming response
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
            console.log('[openaiProxy] Capturing tool calls from JSON response', {
              count: message.tool_calls.length,
              callIds: message.tool_calls.map(tc => tc?.id)
            });
            persistence.addToolCalls(message.tool_calls);
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
        console.warn('[openaiProxy] Failed to update prompt usage:', error.message);
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
