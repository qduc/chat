/**
 * Utilities for handling API response formatting and metadata
 */

/**
 * Adds conversation metadata to response body if persistence is enabled
 * @param {Object} responseBody - The response object to modify
 * @param {SimplifiedPersistence} persistence - Persistence instance
 * @returns {Object} The modified response body
 */
export function addConversationMetadata(responseBody, persistence) {
  if (persistence?.persist && persistence.conversationMeta) {
    responseBody._conversation = {
      id: persistence.conversationId,
      title: persistence.conversationMeta.title,
      model: persistence.conversationMeta.model,
      created_at: persistence.conversationMeta.created_at,
      tools_enabled: Boolean(persistence.conversationMeta.tools_enabled),
      active_tools: Array.isArray(persistence.conversationMeta.metadata?.active_tools)
        ? persistence.conversationMeta.metadata.active_tools
        : [],
      active_system_prompt_id: persistence.conversationMeta.metadata?.active_system_prompt_id || null,
      seq: persistence.assistantSeq || null,
  user_message_id: persistence.userMessageId ?? null,
  assistant_message_id: persistence.assistantMessageId ?? (persistence.currentMessageId != null ? String(persistence.currentMessageId) : null),
    };
  }
  return responseBody;
}

/**
 * Creates a conversation metadata object for streaming events
 * @param {SimplifiedPersistence} persistence - Persistence instance
 * @returns {Object|null} Conversation metadata object or null if not available
 */
export function getConversationMetadata(persistence) {
  if (persistence?.persist && persistence.conversationMeta) {
    return {
      _conversation: {
        id: persistence.conversationId,
        title: persistence.conversationMeta.title,
        model: persistence.conversationMeta.model,
        created_at: persistence.conversationMeta.created_at,
        tools_enabled: Boolean(persistence.conversationMeta.tools_enabled),
        active_tools: Array.isArray(persistence.conversationMeta.metadata?.active_tools)
          ? persistence.conversationMeta.metadata.active_tools
          : [],
        active_system_prompt_id: persistence.conversationMeta.metadata?.active_system_prompt_id || null,
        seq: persistence.assistantSeq || null,
    user_message_id: persistence.userMessageId ?? null,
    assistant_message_id: persistence.assistantMessageId ?? (persistence.currentMessageId != null ? String(persistence.currentMessageId) : null),
      }
    };
  }
  return null;
}
