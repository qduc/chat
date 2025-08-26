import {
  getDb,
  upsertSession,
  getConversationById,
  countMessagesByConversation,
  getNextSeq,
  insertUserMessage,
  createAssistantDraft,
  appendAssistantContent,
  finalizeAssistantMessage,
  markAssistantError,
} from '../db/index.js';

/**
 * Setup persistence for the request if enabled and conversation ID is provided
 * @param {Object} params - Persistence setup parameters
 * @param {Object} params.config - Configuration object
 * @param {string|null} params.conversationId - Conversation ID
 * @param {string} params.sessionId - Session ID
 * @param {Object} params.req - Express request object
 * @param {Object} params.res - Express response object
 * @param {Object} params.bodyIn - Original request body
 * @returns {Promise<{persist: boolean, assistantMessageId: string|null}>} Persistence setup result
 */
export async function setupPersistence({
  config,
  conversationId,
  sessionId,
  req,
  res,
  bodyIn,
}) {
  // Check if persistence is enabled - provide safe fallback if config is undefined
  const persistenceEnabled = config?.persistence?.enabled || false;
  
  if (!persistenceEnabled || !conversationId || !sessionId) {
    return { persist: false, assistantMessageId: null };
  }

  // Ensure DB session row
  getDb();
  upsertSession(sessionId, {
    userAgent: req.header('user-agent') || null,
  });

  // Guard conversation ownership
  const convo = getConversationById({ id: conversationId, sessionId });
  if (!convo) {
    return { persist: false, assistantMessageId: null };
  }

  // Enforce message limit
  const cnt = countMessagesByConversation(conversationId);
  const maxMessages = config?.persistence?.maxMessagesPerConversation || 1000;
  if (cnt >= maxMessages) {
    res.status(429).json({
      error: 'limit_exceeded',
      message: 'Max messages per conversation reached',
    });
    throw new Error('Message limit exceeded');
  }

  // Determine next seq for user and assistant
  const userSeq = getNextSeq(conversationId);

  // Persist user message if available
  const msgs = Array.isArray(bodyIn.messages) ? bodyIn.messages : [];
  const lastUser = [...msgs]
    .reverse()
    .find((m) => m && m.role === 'user' && typeof m.content === 'string');
  
  if (lastUser) {
    insertUserMessage({
      conversationId,
      content: lastUser.content,
      seq: userSeq,
    });
  }

  // Assistant seq right after
  const assistantSeq = userSeq + 1;
  const draft = createAssistantDraft({
    conversationId,
    seq: assistantSeq,
  });

  return {
    persist: true,
    assistantMessageId: draft.id,
  };
}

/**
 * Setup persistence timer for streaming responses
 * @param {Object} params - Timer setup parameters
 * @param {boolean} params.persist - Whether persistence is enabled
 * @param {number} params.flushMs - Flush interval in milliseconds
 * @param {Function} params.doFlush - Flush function to call
 * @returns {NodeJS.Timeout|null} Timer reference or null
 */
export function setupPersistenceTimer({ persist, flushMs, doFlush }) {
  if (!persist) return null;

  return setInterval(() => {
    try {
      doFlush();
    } catch (e) {
      console.error('[persist] flush error', e);
    }
  }, flushMs);
}

/**
 * Handle persistence for non-streaming responses
 * @param {Object} params - Non-streaming persistence parameters
 * @param {boolean} params.persist - Whether persistence is enabled
 * @param {string|null} params.assistantMessageId - Assistant message ID
 * @param {string|null} params.content - Response content
 * @param {string|null} params.finishReason - Finish reason
 */
export async function handleNonStreamingPersistence({
  upstream,
  useResponsesAPI,
  persist,
  assistantMessageId,
  finalizeAssistantMessage,
  markAssistantError,
}) {
  const body = await upstream.json();

  if (!upstream.ok) {
    if (persist && assistantMessageId) {
      markAssistantError({ messageId: assistantMessageId });
    }
    return { status: upstream.status, response: body };
  }

  if (persist && assistantMessageId) {
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
      appendAssistantContent({
        messageId: assistantMessageId,
        delta: content,
      });
    }
    finalizeAssistantMessage({
      messageId: assistantMessageId,
      finishReason: finishReason,
    });
  }

  return { status: 200, response: body };
}

/**
 * Clean up persistence timer
 * @param {NodeJS.Timeout|null} flushTimer - Timer to clear
 */
export function cleanupPersistenceTimer(flushTimer) {
  if (flushTimer) {
    clearInterval(flushTimer);
  }
}

// Re-export persistence functions for use in other modules
export {
  appendAssistantContent,
  finalizeAssistantMessage,
  markAssistantError,
};