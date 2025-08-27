import fetch from 'node-fetch';
import { config } from '../env.js';
import { handleUnifiedToolOrchestration } from './unifiedToolOrchestrator.js';
import { handleIterativeOrchestration } from './iterativeOrchestrator.js';
import {
  setupStreamingHeaders,
  handleRegularStreaming,
} from './streamingHandler.js';
import { SimplifiedPersistence } from './simplifiedPersistence.js';

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

  // Map compatibility fields for Responses API
  if (useResponsesAPI) {
    if (body.reasoning_effort) {
      const modelName = String(body.model || '').toLowerCase();
      const supportsReasoning =
        modelName.includes('o4') || modelName.includes('o3') || modelName.includes('reasoning');
      if (supportsReasoning) {
        body.reasoning = { effort: body.reasoning_effort };
      }
      // Always remove the compatibility field to avoid upstream 400s
      delete body.reasoning_effort;
    }
    // The Responses API may not recognize 'verbosity'; drop to avoid 400s
    if (body.verbosity) delete body.verbosity;
  }

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
    const url = `${base}/v1/${useResponsesAPI ? 'responses' : 'chat/completions'}`;
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

        if (useResponsesAPI) {
          // Responses API format
          if (body.output && body.output[0] && body.output[0].content && body.output[0].content[0]) {
            content = body.output[0].content[0].text;
          }
          finishReason = body.status;
        } else {
          // Chat Completions format
          if (body.choices && body.choices[0] && body.choices[0].message) {
            content = body.choices[0].message.content;
          }
          finishReason = body.choices && body.choices[0] ? body.choices[0].finish_reason : null;
        }

        if (content) {
          persistence.appendContent(content);
        }
        persistence.recordAssistantFinal({ finishReason });
      }

      return res.status(200).json(body);
    }

    // Setup streaming headers
    setupStreamingHeaders(res);

    // Handle regular streaming (non-tool orchestration)
    return await handleRegularStreaming({
      upstream,
      res,
      req,
      persistence,
      useResponsesAPI,
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
