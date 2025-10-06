/**
 * Test utilities for creating intent envelopes
 * Phase 4: All requests now require intent envelopes
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Create an append_message intent envelope for tests
 */
export function createAppendIntent({
  messages,
  conversationId,
  afterMessageId,
  afterSeq,
  truncateAfter = false,
  model = 'gpt-3.5-turbo',
  stream = false,
  ...completionParams
}) {
  const intent = {
    type: 'append_message',
    client_operation: `test-op-${uuidv4()}`,
    messages,
    completion: {
      model,
      stream,
      ...completionParams
    }
  };

  if (conversationId) {
    intent.conversation_id = conversationId;
  }

  if (afterMessageId) {
    intent.after_message_id = afterMessageId;
  }

  if (afterSeq !== undefined) {
    intent.after_seq = afterSeq;
  }

  if (truncateAfter) {
    intent.truncate_after = truncateAfter;
  }

  return { intent };
}

/**
 * Create an edit_message intent envelope for tests
 */
export function createEditIntent({
  messageId,
  expectedSeq,
  content,
  conversationId
}) {
  const intent = {
    type: 'edit_message',
    client_operation: `test-op-${uuidv4()}`,
    message_id: messageId,
    expected_seq: expectedSeq,
    content
  };

  if (conversationId) {
    intent.conversation_id = conversationId;
  }

  return { intent };
}
