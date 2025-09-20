import { config } from '../env.js';
import { generateOpenAIToolSpecs } from './tools.js';
import { handleUnifiedToolOrchestration } from './unifiedToolOrchestrator.js';
import { handleIterativeOrchestration } from './iterativeOrchestrator.js';
import { handleRegularStreaming } from './streamingHandler.js';
import { setupStreamingHeaders, createOpenAIRequest } from './streamUtils.js';
import { providerSupportsReasoning, getDefaultModel } from './providers/index.js';
import { SimplifiedPersistence } from './simplifiedPersistence.js';
import { addConversationMetadata } from './responseUtils.js';
import { logger } from '../logger.js';

// --- Helpers: sanitize, validate, selection, and error shaping ---

function sanitizeIncomingBody(bodyIn, _cfg) {
  const body = { ...bodyIn };
  // Map optional system prompt param to a leading system message
  try {
    const sys = (bodyIn.systemPrompt ?? bodyIn.system_prompt);
    if (typeof sys === 'string' && sys.trim()) {
      const systemMsg = { role: 'system', content: sys.trim() };
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
  delete body.systemPrompt;
  delete body.system_prompt;
  // Default model
  // Default model is resolved later (may come from DB)

  // Allow a simplified tools representation from frontend: an array of tool names (strings).
  // Expand into full OpenAI-compatible tool specs using server-side registry.
  try {
    if (Array.isArray(bodyIn.tools) && bodyIn.tools.length > 0 && typeof bodyIn.tools[0] === 'string') {
      const allSpecs = generateOpenAIToolSpecs();
      const selected = allSpecs.filter(s => bodyIn.tools.includes(s.function?.name));
      body.tools = selected;
    }
  } catch (e) {
    // ignore expansion errors and let downstream validation handle unexpected shapes
  }
  return body;
}

function validateAndNormalizeReasoningControls(body) {
  // Only allow reasoning controls if provider+model supports it
  const isAllowed = providerSupportsReasoning(config, body.model);

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

function getFlags(bodyIn, body) {
  const hasTools = Array.isArray(bodyIn.tools) && bodyIn.tools.length > 0;
  const stream = !!body.stream;
  return { hasTools, stream };
}

function selectMode(flags) {
  return `${flags.hasTools ? 'tools' : 'plain'}:${flags.stream ? 'stream' : 'json'}`;
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

export async function proxyOpenAIRequest(req, res) {
  const bodyIn = req.body || {};
  const body = sanitizeIncomingBody(bodyIn, config);
  const providerId = bodyIn.provider_id || req.header('x-provider-id') || undefined;

  // Resolve default model from DB-backed provider settings when missing
  if (!body.model) {
    body.model = await getDefaultModel(config, { providerId });
  }

  // Validate reasoning controls early and return guard failures
  const validation = validateAndNormalizeReasoningControls(body);
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
    return res.status(validation.status).json(validation.payload);
  }

  // Pull optional conversation_id from body or header
  const conversationId = bodyIn.conversation_id || req.header('x-conversation-id');
  const flags = getFlags(bodyIn, body);

  // Persistence setup
  const persistence = new SimplifiedPersistence(config);
  const sessionId = req.sessionId;

  // Strategy handlers (selected by flags)
  const handlers = {
    'tools:stream': ({ body, bodyIn, req, res, config, persistence }) =>
      handleIterativeOrchestration({ body, bodyIn, config, res, req, persistence }),

    'tools:json': ({ body, bodyIn, req, res, config, persistence }) =>
      handleUnifiedToolOrchestration({ body, bodyIn, config, res, req, persistence }),

    'plain:stream': async ({ body, req, res, config, persistence }) => {
      const upstream = await createOpenAIRequest(config, body, { providerId });
      if (!upstream.ok) {
        const errorJson = await readUpstreamError(upstream);
        if (persistence.persist) persistence.markError();
        return res.status(upstream.status).json(errorJson);
      }
      // Setup streaming headers only after confirming upstream is ok
      setupStreamingHeaders(res);
      return handleRegularStreaming({ config, upstream, res, req, persistence });
    },

  'plain:json': async ({ body, req: _req, res, config, persistence }) => {
      const upstream = await createOpenAIRequest(config, body, { providerId });
      if (!upstream.ok) {
        const errorJson = await readUpstreamError(upstream);
        if (persistence.persist) persistence.markError();
        return res.status(upstream.status).json(errorJson);
      }

      const upstreamJson = await upstream.json();

      if (persistence.persist) {
        let content = '';
        let finishReason = null;
        if (upstreamJson.choices && upstreamJson.choices[0] && upstreamJson.choices[0].message) {
          content = upstreamJson.choices[0].message.content;
        }
        finishReason = upstreamJson.choices && upstreamJson.choices[0]
          ? upstreamJson.choices[0].finish_reason
          : null;

        if (content) persistence.appendContent(content);
        persistence.recordAssistantFinal({ finishReason });
      }

      const responseBody = { ...upstreamJson };
      addConversationMetadata(responseBody, persistence);
      return res.status(200).json(responseBody);
    },
  };

  try {
    await persistence.initialize({ conversationId, sessionId, req, res, bodyIn });

    const mode = selectMode(flags);
    const handler = handlers[mode];

    if (!handler) {
      // Fallback safety – should not happen
      logger.error({
        msg: 'unsupported_mode_error',
        error: {
          message: `Unsupported mode: ${mode}`,
          type: 'invalid_request_error',
        },
        req: {
          id: req.id,
          method: req.method,
          url: req.url,
          body: req.body,
        },
        mode,
        flags,
        modeError: `Unsupported mode: ${mode} (hasTools: ${flags.hasTools}, stream: ${flags.stream})`,
      });
      return res.status(400).json({ error: 'invalid_request_error', message: `Unsupported mode: ${mode}` });
    }

    return await handler({ req, res, config, bodyIn, body, flags, persistence });
  } catch (error) {
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
  } finally {
    if (persistence) {
      persistence.cleanup();
    }
  }
}
