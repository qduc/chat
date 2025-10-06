import { 
  createIntentError 
} from './validation/messageIntentSchemas.js';
import {
  getConversationById
} from '../db/conversations.js';
import {
  getMessageByIdAndSeq,
  getLastMessage,
  getMessagesPage
} from '../db/messages.js';
import { logger } from '../logger.js';

/**
 * Process an append_message intent
 * @param {object} intent - The append_message intent
 * @param {string} userId - The authenticated user ID
 * @returns {object} - Success response or error
 */
export function validateAppendMessageIntent(intent, userId) {
  const { 
    client_operation, 
    conversation_id, 
    after_message_id, 
    after_seq, 
    truncate_after 
  } = intent;

  // Log the intent
  logger.info({
    msg: 'validating_append_message_intent',
    user_id: userId,
    conversation_id,
    client_operation,
    after_seq,
    truncate_after: truncate_after || false
  });

  // Case 1: New conversation (no conversation_id)
  if (!conversation_id) {
    return { valid: true };
  }

  // Case 2: Existing conversation - validate it exists and belongs to user
  const conversation = getConversationById({ id: conversation_id, userId });
  if (!conversation) {
    return {
      valid: false,
      error: createIntentError(
        'conversation_not_found',
        'The specified conversation does not exist or does not belong to you',
        client_operation
      )
    };
  }

  // Validate after_message_id and after_seq are provided
  if (!after_message_id || after_seq === undefined) {
    return {
      valid: false,
      error: createIntentError(
        'missing_required_field',
        'When conversation_id is provided, both after_message_id and after_seq are required',
        client_operation,
        { field: 'after_message_id, after_seq' }
      )
    };
  }

  // Validate the referenced message exists and has the expected seq
  const referencedMessage = getMessageByIdAndSeq({
    messageId: after_message_id,
    conversationId: conversation_id,
    expectedSeq: after_seq
  });

  if (!referencedMessage) {
    // Check if message exists but with different seq (optimistic lock failure)
    const messageWithoutSeqCheck = getMessageByIdAndSeq({
      messageId: after_message_id,
      conversationId: conversation_id
    });

    if (messageWithoutSeqCheck) {
      return {
        valid: false,
        error: createIntentError(
          'seq_mismatch',
          'The sequence number does not match the current message sequence (optimistic lock failure)',
          client_operation,
          {
            field: 'after_seq',
            expected: messageWithoutSeqCheck.seq,
            actual: after_seq
          }
        )
      };
    }

    return {
      valid: false,
      error: createIntentError(
        'message_not_found',
        'The referenced message does not exist in this conversation',
        client_operation,
        { field: 'after_message_id' }
      )
    };
  }

  // If truncate_after is false, validate that after_message_id is the last message
  if (!truncate_after) {
    const lastMessage = getLastMessage({ conversationId: conversation_id });
    if (lastMessage && lastMessage.id !== after_message_id) {
      return {
        valid: false,
        error: createIntentError(
          'not_last_message',
          'Cannot append after a non-terminal message without truncate_after=true',
          client_operation,
          {
            field: 'after_message_id',
            expected: lastMessage.id,
            actual: after_message_id
          }
        )
      };
    }
  }

  return { valid: true };
}

/**
 * Process an edit_message intent validation
 * @param {object} intent - The edit_message intent
 * @param {string} userId - The authenticated user ID
 * @param {string} conversationId - The conversation ID from URL params
 * @returns {object} - Validation result
 */
export function validateEditMessageIntent(intent, userId, conversationId) {
  const { 
    client_operation, 
    message_id, 
    expected_seq,
    conversation_id: intentConversationId
  } = intent;

  // Log the intent
  logger.info({
    msg: 'validating_edit_message_intent',
    user_id: userId,
    conversation_id: conversationId,
    message_id,
    client_operation,
    expected_seq
  });

  // Validate conversation exists and belongs to user
  const conversation = getConversationById({ id: conversationId, userId });
  if (!conversation) {
    return {
      valid: false,
      error: createIntentError(
        'conversation_not_found',
        'The specified conversation does not exist or does not belong to you',
        client_operation
      )
    };
  }

  // If intent includes conversation_id, validate it matches the URL param
  if (intentConversationId && intentConversationId !== conversationId) {
    return {
      valid: false,
      error: createIntentError(
        'conversation_mismatch',
        'The conversation_id in the intent does not match the URL parameter',
        client_operation,
        {
          field: 'conversation_id',
          expected: conversationId,
          actual: intentConversationId
        }
      )
    };
  }

  // Validate the message exists and has the expected seq
  const message = getMessageByIdAndSeq({
    messageId: message_id,
    conversationId: conversationId,
    expectedSeq: expected_seq
  });

  if (!message) {
    // Check if message exists but with different seq (optimistic lock failure)
    const messageWithoutSeqCheck = getMessageByIdAndSeq({
      messageId: message_id,
      conversationId: conversationId
    });

    if (messageWithoutSeqCheck) {
      return {
        valid: false,
        error: createIntentError(
          'seq_mismatch',
          'The sequence number does not match the current message sequence (optimistic lock failure)',
          client_operation,
          {
            field: 'expected_seq',
            expected: messageWithoutSeqCheck.seq,
            actual: expected_seq
          }
        )
      };
    }

    return {
      valid: false,
      error: createIntentError(
        'message_not_found',
        'The specified message does not exist in this conversation',
        client_operation,
        { field: 'message_id' }
      )
    };
  }

  // Validate that the message is a user message
  if (message.role !== 'user') {
    return {
      valid: false,
      error: createIntentError(
        'edit_not_allowed',
        'Only user messages can be edited',
        client_operation,
        {
          field: 'role',
          expected: 'user',
          actual: message.role
        }
      )
    };
  }

  return { valid: true, message };
}

/**
 * Calculate deleted messages for truncate_after operation
 * @param {string} conversationId - The conversation ID
 * @param {number} afterSeq - The sequence number after which to truncate
 * @returns {Array} - Array of deleted message records
 */
export function getMessagesToTruncate(conversationId, afterSeq) {
  const deletedMessages = [];
  let currentAfterSeq = afterSeq;
  
  // Fetch all messages after the specified seq
  while (true) {
    const page = getMessagesPage({
      conversationId,
      afterSeq: currentAfterSeq,
      limit: 100
    });
    
    if (!page.messages || page.messages.length === 0) {
      break;
    }
    
    // Add messages to deleted list
    for (const msg of page.messages) {
      deletedMessages.push({
        id: msg.id,
        seq: msg.seq,
        role: msg.role
      });
    }
    
    if (!page.next_after_seq) {
      break;
    }
    
    currentAfterSeq = page.next_after_seq;
  }
  
  return deletedMessages;
}

/**
 * Track operations for intent response
 * Used to build the operations object in the success response
 */
export class OperationsTracker {
  constructor() {
    this.inserted = [];
    this.updated = [];
    this.deleted = [];
  }

  addInserted(id, seq, role) {
    this.inserted.push({ id, seq, role });
  }

  addUpdated(id, seq, role) {
    this.updated.push({ id, seq, role });
  }

  addDeleted(id, seq, role) {
    this.deleted.push({ id, seq, role });
  }

  addDeletedMessages(messages) {
    for (const msg of messages) {
      this.deleted.push({
        id: msg.id,
        seq: msg.seq,
        role: msg.role
      });
    }
  }

  getOperations() {
    return {
      inserted: this.inserted,
      updated: this.updated,
      deleted: this.deleted
    };
  }
}
