/**
 * Example client for using the Message Intent Schema
 * 
 * This demonstrates how to use the intent envelope system for chat operations.
 * See docs/message-intent-schema.md for full specification.
 */

import { v4 as uuidv4 } from 'uuid';

class IntentClient {
  constructor(apiBaseUrl, authToken) {
    this.apiBaseUrl = apiBaseUrl;
    this.authToken = authToken;
  }

  /**
   * Create a new conversation with the first message
   */
  async createConversation(userMessage, options = {}) {
    const intent = {
      type: 'append_message',
      client_operation: uuidv4(),
      messages: [{
        role: 'user',
        content: userMessage
      }],
      completion: {
        model: options.model || 'gpt-4',
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        ...options.completionOptions
      }
    };

    if (options.metadata) {
      intent.metadata = options.metadata;
    }

    const response = await fetch(`${this.apiBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`
      },
      body: JSON.stringify({ intent })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new IntentError(error);
    }

    return await response.json();
  }

  /**
   * Append a message to an existing conversation
   */
  async appendToConversation(conversationId, afterMessageId, afterSeq, userMessage, options = {}) {
    const intent = {
      type: 'append_message',
      client_operation: uuidv4(),
      conversation_id: conversationId,
      after_message_id: afterMessageId,
      after_seq: afterSeq,
      truncate_after: options.truncateAfter || false,
      messages: [{
        role: 'user',
        content: userMessage
      }],
      completion: {
        model: options.model || 'gpt-4',
        ...options.completionOptions
      }
    };

    if (options.metadata) {
      intent.metadata = options.metadata;
    }

    const response = await fetch(`${this.apiBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`
      },
      body: JSON.stringify({ intent })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new IntentError(error);
    }

    return await response.json();
  }

  /**
   * Regenerate the last assistant response
   */
  async regenerateResponse(conversationId, userMessageId, userSeq, options = {}) {
    return this.appendToConversation(
      conversationId,
      userMessageId,
      userSeq,
      '', // No new user message
      { ...options, truncateAfter: true }
    );
  }

  /**
   * Edit a user message and fork the conversation
   */
  async editMessage(conversationId, messageId, expectedSeq, newContent, options = {}) {
    const intent = {
      type: 'edit_message',
      client_operation: uuidv4(),
      message_id: messageId,
      expected_seq: expectedSeq,
      content: newContent
    };

    if (options.metadata) {
      intent.metadata = options.metadata;
    }

    const response = await fetch(
      `${this.apiBaseUrl}/v1/conversations/${conversationId}/messages/${messageId}/edit`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        body: JSON.stringify({ intent })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new IntentError(error);
    }

    return await response.json();
  }

  /**
   * Branch from a specific point in the conversation
   */
  async branchConversation(conversationId, fromMessageId, fromSeq, newUserMessage, options = {}) {
    return this.appendToConversation(
      conversationId,
      fromMessageId,
      fromSeq,
      newUserMessage,
      { ...options, truncateAfter: true }
    );
  }
}

class IntentError extends Error {
  constructor(errorResponse) {
    super(errorResponse.message);
    this.name = 'IntentError';
    this.errorCode = errorResponse.error_code;
    this.clientOperation = errorResponse.client_operation;
    this.details = errorResponse.details;
    this.response = errorResponse;
  }

  isOptimisticLockFailure() {
    return this.errorCode === 'seq_mismatch';
  }

  isConversationNotFound() {
    return this.errorCode === 'conversation_not_found';
  }

  isMessageNotFound() {
    return this.errorCode === 'message_not_found';
  }
}

// Example usage
async function exampleUsage() {
  const client = new IntentClient('http://localhost:3002/api', 'your-auth-token');

  try {
    // Create a new conversation
    console.log('Creating new conversation...');
    const createResult = await client.createConversation(
      'What is the capital of France?',
      { model: 'gpt-4', metadata: { source: 'example-client' } }
    );
    console.log('Created:', createResult);
    
    const conversationId = createResult.conversation_id;
    const lastInserted = createResult.operations.inserted[createResult.operations.inserted.length - 1];

    // Append to the conversation
    console.log('\nAppending to conversation...');
    const appendResult = await client.appendToConversation(
      conversationId,
      lastInserted.id,
      lastInserted.seq,
      'Tell me more about Paris'
    );
    console.log('Appended:', appendResult);

    // Get the first user message
    const firstUserMessage = createResult.operations.inserted.find(m => m.role === 'user');

    // Edit the first message (creates a fork)
    console.log('\nEditing first message...');
    const editResult = await client.editMessage(
      conversationId,
      firstUserMessage.id,
      firstUserMessage.seq,
      'What is the capital of Germany?'
    );
    console.log('Edited:', editResult);
    console.log('Forked conversation:', editResult.fork_conversation_id);

  } catch (error) {
    if (error instanceof IntentError) {
      console.error('Intent operation failed:', error.errorCode);
      console.error('Details:', error.details);
      
      if (error.isOptimisticLockFailure()) {
        console.error('Sequence mismatch - conversation was modified by another client');
        console.error(`Expected seq: ${error.details.expected}, Got: ${error.details.actual}`);
        // In production: reload conversation and retry
      }
    } else {
      console.error('Unexpected error:', error);
    }
  }
}

// Utility: Retry with optimistic locking
async function retryWithReload(operation, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof IntentError && error.isOptimisticLockFailure()) {
        if (i < maxRetries - 1) {
          console.log(`Optimistic lock failure, retrying (${i + 1}/${maxRetries})...`);
          // In production: reload conversation to get current seq
          continue;
        }
      }
      throw error;
    }
  }
}

export { IntentClient, IntentError, retryWithReload };

// Run example if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  exampleUsage();
}
