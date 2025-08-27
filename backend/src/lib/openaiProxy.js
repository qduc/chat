import fetch from 'node-fetch';
import { config } from '../env.js';
import { handleUnifiedToolOrchestration } from './unifiedToolOrchestrator.js';
import { handleIterativeOrchestration } from './iterativeOrchestrator.js';
import {
  setupStreamingHeaders,
  handleRegularStreaming,
} from './streamingHandler.js';
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

  // ...existing code...

  // ...existing code...

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
        // Prepare SSE response for streaming tool orchestration
        setupStreamingHeaders(res);
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

  // Make upstream request
  // Build upstream URL resiliently whether base has trailing /v1 or not
  const base = (config.openaiBaseUrl || '').replace(/\/v1\/?$/, '');
  const url = `${base}/v1/chat/completions`;
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
      const body = await upstream.json();

      if (!upstream.ok) {
        if (persistence.persist) {
          persistence.markError();
        }
        return res.status(upstream.status).json(body);
      }

      // Extract content and finish reason from response
      if (persistence.persist) {
        let content = '';
        let finishReason = null;

        // Chat Completions format only
        if (body.choices && body.choices[0] && body.choices[0].message) {
          content = body.choices[0].message.content;
        }
        finishReason = body.choices && body.choices[0] ? body.choices[0].finish_reason : null;

        if (content) {
          persistence.appendContent(content);
        }
        persistence.recordAssistantFinal({ finishReason });
      }

      // Include conversation metadata in response if auto-created
      const responseBody = { ...body };
      addConversationMetadata(responseBody, persistence);

      return res.status(200).json(responseBody);
    }

    // Setup streaming headers
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
