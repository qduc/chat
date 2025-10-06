import { validateIntentEnvelope } from './validation/messageIntentSchemas.js';
import {
  validateAppendMessageIntent,
  validateEditMessageIntent,
  OperationsTracker
} from './intentService.js';
import { logger } from '../logger.js';

/**
 * Middleware to detect and parse intent envelopes
 * Phase 4: Strict enforcement - all requests MUST include a valid intent envelope
 * Attaches intent to req.intent
 * Sets req.hasIntent flag
 */
export function detectIntentEnvelope(req, res, next) {
  // Phase 4: Require intent envelope on all requests
  if (!req.body || !req.body.intent) {
    logger.warn({
      msg: 'intent_missing',
      error_code: 'intent_required',
      user_id: req.user?.id,
      endpoint: req.originalUrl
    });

    return res.status(400).json({
      success: false,
      error: 'validation_error',
      error_code: 'intent_required',
      message: 'Intent envelope is required for all message mutations. See docs/message-intent-schema.md for details.'
    });
  }

  try {
    // Validate the intent envelope structure
    const envelope = validateIntentEnvelope(req.body);
    req.intent = envelope.intent;
    req.hasIntent = true;

    logger.info({
      msg: 'intent_envelope_detected',
      intent_type: req.intent.type,
      client_operation: req.intent.client_operation,
      user_id: req.user?.id
    });

    next();
  } catch (error) {
    // Intent validation failed
    logger.warn({
      msg: 'intent_validation_failed',
      error: error.message,
      user_id: req.user?.id
    });

    return res.status(400).json({
      success: false,
      error: 'validation_error',
      error_code: 'invalid_intent',
      message: error.message,
      client_operation: req.body?.intent?.client_operation
    });
  }
}

/**
 * Validate append_message intent before processing
 * Phase 4: Intent is now required by detectIntentEnvelope
 * Should be called after detectIntentEnvelope for POST /v1/chat/completions
 */
export function validateAppendIntent(req, res, next) {
  // Phase 4: Intent is guaranteed to exist by detectIntentEnvelope
  // Only validate append_message intents
  if (req.intent.type !== 'append_message') {
    return res.status(400).json({
      success: false,
      error: 'validation_error',
      error_code: 'invalid_intent_type',
      message: 'Expected append_message intent for this endpoint',
      client_operation: req.intent.client_operation
    });
  }

  const userId = req.user.id;
  const validation = validateAppendMessageIntent(req.intent, userId);

  if (!validation.valid) {
    logger.warn({
      msg: 'append_intent_validation_failed',
      error_code: validation.error.error_code,
      user_id: userId,
      client_operation: req.intent.client_operation
    });

    return res.status(400).json(validation.error);
  }

  // Attach operations tracker for downstream use
  req.operationsTracker = new OperationsTracker();

  next();
}

/**
 * Validate edit_message intent before processing
 * Phase 4: Intent is now required by detectIntentEnvelope
 * Should be called after detectIntentEnvelope for PUT /v1/conversations/:id/messages/:messageId/edit
 */
export function validateEditIntent(req, res, next) {
  // Phase 4: Intent is guaranteed to exist by detectIntentEnvelope
  // Only validate edit_message intents
  if (req.intent.type !== 'edit_message') {
    return res.status(400).json({
      success: false,
      error: 'validation_error',
      error_code: 'invalid_intent_type',
      message: 'Expected edit_message intent for this endpoint',
      client_operation: req.intent.client_operation
    });
  }

  const userId = req.user.id;
  const conversationId = req.params.id;
  const validation = validateEditMessageIntent(req.intent, userId, conversationId);

  if (!validation.valid) {
    logger.warn({
      msg: 'edit_intent_validation_failed',
      error_code: validation.error.error_code,
      user_id: userId,
      client_operation: req.intent.client_operation
    });

    return res.status(400).json(validation.error);
  }

  // Attach operations tracker for downstream use
  req.operationsTracker = new OperationsTracker();

  next();
}

/**
 * Transform intent-based request to legacy format
 * Phase 4: All requests now have intents (enforced by detectIntentEnvelope)
 * This allows the existing proxy logic to work unchanged
 */
export function transformIntentToLegacy(req, res, next) {
  const intent = req.intent;

  if (intent.type === 'append_message') {
    // Transform append_message intent to legacy chat completions format
    const legacyBody = {
      ...intent.completion,
      messages: intent.messages,
      conversation_id: intent.conversation_id,
      // Store intent metadata for later use
      _intent: {
        client_operation: intent.client_operation,
        after_message_id: intent.after_message_id,
        after_seq: intent.after_seq,
        truncate_after: intent.truncate_after,
        metadata: intent.metadata
      }
    };

    // Replace request body with legacy format
    req.body = legacyBody;
  } else if (intent.type === 'edit_message') {
    // Transform edit_message intent to legacy format
    const legacyBody = {
      content: intent.content,
      _intent: {
        client_operation: intent.client_operation,
        message_id: intent.message_id,
        expected_seq: intent.expected_seq,
        metadata: intent.metadata
      }
    };

    // Replace request body with legacy format
    req.body = legacyBody;
  }

  next();
}

/**
 * Wrap response to return intent-formatted response
 * Phase 4: All requests now have intents (enforced by detectIntentEnvelope)
 * This intercepts res.json to transform legacy responses to intent format
 */
export function wrapIntentResponse(req, res, next) {
  // Store original res.json
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  // Override res.json to transform response
  res.json = function(data) {
    // Skip transformation for error responses
    if (res.statusCode >= 400) {
      return originalJson(data);
    }

    // Skip transformation for streaming responses (they handle their own format)
    if (req.body?.stream) {
      return originalJson(data);
    }

    // Extract conversation_id from various possible locations
    const conversationId = data.conversation_id
      || data._conversation?.id
      || req.body?._intent?.conversation_id
      || req.params?.id;

    // Transform to intent success response format
    const intentResponse = {
      success: true,
      conversation_id: conversationId,
      client_operation: req.intent.client_operation,
      operations: req.operationsTracker?.getOperations() || {
        inserted: [],
        updated: [],
        deleted: []
      }
    };

    // Add fork_conversation_id for edit operations
    if (data.new_conversation_id) {
      intentResponse.fork_conversation_id = data.new_conversation_id;
    }

    // Add metadata if present
    if (req.intent.metadata) {
      intentResponse.metadata = req.intent.metadata;
    }

    return originalJson(intentResponse);
  };

  // Also override res.send for non-JSON responses
  res.send = function(data) {
    // For streaming, pass through
    return originalSend(data);
  };

  next();
}
