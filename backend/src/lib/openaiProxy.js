import { config } from '../env.js';
import { handleUnifiedToolOrchestration } from './unifiedToolOrchestrator.js';
import { handleIterativeOrchestration } from './iterativeOrchestrator.js';
import { handleRegularStreaming } from './streamingHandler.js';
import { setupStreamingHeaders, createOpenAIRequest } from './streamUtils.js';
import { SimplifiedPersistence } from './simplifiedPersistence.js';
import { addConversationMetadata } from './responseUtils.js';

export async function proxyOpenAIRequest(req, res) {
  const bodyIn = req.body || {};

  // Pull optional conversation_id from body or header
  const conversationId =
    bodyIn.conversation_id || req.header('x-conversation-id');

  const hasTools = Array.isArray(bodyIn.tools) && bodyIn.tools.length > 0;


  // Clone and strip non-upstream fields
  const body = { ...bodyIn };
  delete body.conversation_id;
  delete body.streamingEnabled;
  delete body.toolsEnabled;
  delete body.researchMode;
  delete body.qualityLevel;

  // Only allow reasoning controls for gpt-5* models; strip otherwise
  const isGpt5 = typeof body.model === 'string' && body.model.startsWith('gpt-5');

  // Validate and handle reasoning_effort
  if (body.reasoning_effort) {
    // If not gpt-5, drop the field silently
    if (!isGpt5) {
      delete body.reasoning_effort;
    } else {
      const allowedEfforts = ['minimal', 'low', 'medium', 'high'];
      if (!allowedEfforts.includes(body.reasoning_effort)) {
        return res.status(400).json({
          error: 'invalid_request_error',
          message: `Invalid reasoning_effort. Must be one of ${allowedEfforts.join(', ')}`,
        });
      }
    }
  }

  // Validate and handle verbosity
  if (body.verbosity) {
    if (!isGpt5) {
      delete body.verbosity;
    } else {
      const allowedVerbosity = ['low', 'medium', 'high'];
      if (!allowedVerbosity.includes(body.verbosity)) {
        return res.status(400).json({
          error: 'invalid_request_error',
          message: `Invalid verbosity. Must be one of ${allowedVerbosity.join(', ')}`,
        });
      }
    }
  }

  if (!body.model) body.model = config.defaultModel;
  const stream = !!body.stream;

  // Persistence setup
  const persistence = new SimplifiedPersistence(config);
  const sessionId = req.sessionId;

  try {
    // Setup persistence
    await persistence.initialize({
      conversationId,
      sessionId,
      req,
      res,
      bodyIn,
    });

    // Handle tool orchestration
    if (hasTools) {
      if (stream) {
        // Stream text deltas; buffer tool_calls and emit consolidated call
        return await handleIterativeOrchestration({
          body,
          bodyIn,
          config,
          res,
          req,
          persistence,
        });
      } else {
        // Non-streaming JSON with tool events
        return await handleUnifiedToolOrchestration({
          body,
          bodyIn,
          config,
          res,
          req,
          persistence,
        });
      }
    }

    // Make upstream request via shared helper
    const upstream = await createOpenAIRequest(config, body);

    // Check for errors before setting up streaming
    if (!upstream.ok) {
      let errorJson;
      try {
        errorJson = await upstream.json();
      } catch {
        errorJson = { error: 'upstream_error', message: await upstream.text().catch(() => 'Unknown error') };
      }
      if (persistence.persist) {
        persistence.markError();
      }
      return res.status(upstream.status).json(errorJson);
    }

    // Handle non-streaming responses
    if (!stream) {
      const upstreamJson = await upstream.json();

      // Extract content and finish reason from response
      if (persistence.persist) {
        let content = '';
        let finishReason = null;

        // Chat Completions format only
        if (upstreamJson.choices && upstreamJson.choices[0] && upstreamJson.choices[0].message) {
          content = upstreamJson.choices[0].message.content;
        }
        finishReason = upstreamJson.choices && upstreamJson.choices[0] ? upstreamJson.choices[0].finish_reason : null;

        if (content) {
          persistence.appendContent(content);
        }
        persistence.recordAssistantFinal({ finishReason });
      }

      // Include conversation metadata in response if auto-created
      const responseBody = { ...upstreamJson };
      addConversationMetadata(responseBody, persistence);

      return res.status(200).json(responseBody);
    }

    // Setup streaming headers only after confirming upstream is ok
    setupStreamingHeaders(res);

    // Handle regular streaming (non-tool orchestration)
    return await handleRegularStreaming({
      config,
      upstream,
      res,
      req,
      persistence,
    });

  } catch (error) {
    console.error('[proxy] error', error);
    if (persistence && persistence.persist) {
      persistence.markError();
    }
    res.status(500).json({
      error: 'upstream_error',
      message: error.message
    });
  } finally {
    if (persistence) {
      persistence.cleanup();
    }
  }
}
