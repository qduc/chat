import {
  insertToolCalls,
  insertToolOutputs,
  getToolCallsByMessageId,
  getToolOutputsByMessageId,
} from '../../db/toolCalls.js';
import { logger } from '../../logger.js';

/**
 * Manages persistence of tool calls and outputs
 * Provides integration with the conversation persistence system
 */
export class ToolCallPersistence {
  /**
   * Save tool calls for a message
   * @param {Object} params
   * @param {number} params.messageId - Message ID
   * @param {string} params.conversationId - Conversation ID
   * @param {Array} params.toolCalls - Array of tool calls in OpenAI format
   * @returns {Array} Inserted tool call records
   */
  static saveToolCalls({ messageId, conversationId, toolCalls }) {
    if (!messageId || !conversationId || !Array.isArray(toolCalls) || toolCalls.length === 0) {
      return [];
    }

    try {
      return insertToolCalls({ messageId, conversationId, toolCalls });
    } catch (error) {
      logger.error('[ToolCallPersistence] Error saving tool calls:', error);
      throw error;
    }
  }

  /**
   * Save tool outputs for a message
   * @param {Object} params
   * @param {number} params.messageId - Message ID
   * @param {string} params.conversationId - Conversation ID
   * @param {Array} params.toolOutputs - Array of tool outputs
   * @returns {Array} Inserted tool output records
   */
  static saveToolOutputs({ messageId, conversationId, toolOutputs }) {
    if (!messageId || !conversationId || !Array.isArray(toolOutputs) || toolOutputs.length === 0) {
      return [];
    }

    try {
      return insertToolOutputs({ messageId, conversationId, toolOutputs });
    } catch (error) {
      logger.error('[ToolCallPersistence] Error saving tool outputs:', error);
      throw error;
    }
  }

  /**
   * Load tool calls for a message
   * @param {number} messageId - Message ID
   * @returns {Array} Tool calls in OpenAI format
   */
  static loadToolCalls(messageId) {
    if (!messageId) return [];

    try {
      const toolCalls = getToolCallsByMessageId(messageId);

      // Transform to OpenAI format
      return toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        index: tc.call_index,
        function: {
          name: tc.tool_name,
          arguments: tc.arguments
        },
        textOffset: tc.text_offset
      }));
    } catch (error) {
      logger.error('[ToolCallPersistence] Error loading tool calls:', error);
      return [];
    }
  }

  /**
   * Load tool outputs for a message
   * @param {number} messageId - Message ID
   * @returns {Array} Tool outputs
   */
  static loadToolOutputs(messageId) {
    if (!messageId) return [];

    try {
      const outputs = getToolOutputsByMessageId(messageId);

      // Transform to expected format
      return outputs.map(to => ({
        tool_call_id: to.tool_call_id,
        output: to.output,
        status: to.status
      }));
    } catch (error) {
      logger.error('[ToolCallPersistence] Error loading tool outputs:', error);
      return [];
    }
  }

  /**
   * Save both tool calls and outputs for a message
   * Convenience method for iterative orchestration
   * @param {Object} params
   * @param {number} params.messageId - Message ID
   * @param {string} params.conversationId - Conversation ID
   * @param {Array} params.toolCalls - Array of tool calls
   * @param {Array} params.toolOutputs - Array of tool outputs
   * @returns {Object} Results with both inserted records
   */
  static saveToolCallsAndOutputs({ messageId, conversationId, toolCalls, toolOutputs }) {
    const savedCalls = this.saveToolCalls({ messageId, conversationId, toolCalls });
    const savedOutputs = this.saveToolOutputs({ messageId, conversationId, toolOutputs });

    return {
      toolCalls: savedCalls,
      toolOutputs: savedOutputs
    };
  }
}
