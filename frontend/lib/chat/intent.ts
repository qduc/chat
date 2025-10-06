/**
 * Message Intent Schema - Phase 2: Frontend Implementation
 * 
 * This module implements the intent envelope structure defined in
 * docs/message-intent-schema.md for frontend-to-backend communication.
 */

import type { MessageContent } from './types';

/**
 * Generate a unique client operation ID
 * Uses crypto.randomUUID() for uniqueness
 */
export function generateClientOperation(): string {
  return crypto.randomUUID();
}

/**
 * Base intent fields shared across all intent types
 */
export interface BaseIntent {
  /** Unique client generated ID (UUID) */
  client_operation: string;
  /** Optional ID of the conversation that will be mutated */
  conversation_id?: string;
  /** Optional metadata emitted back to the client for debugging/telemetry */
  metadata?: Record<string, unknown>;
}

/**
 * Intent for appending a new message to a conversation
 */
export interface AppendMessageIntent extends BaseIntent {
  type: 'append_message';
  /**
   * When provided, the newly inserted user message must be placed immediately
   * after this message. Required when conversation_id is provided.
   */
  after_message_id?: string;
  /** Expected sequence number of `after_message_id`. Required when provided. */
  after_seq?: number;
  /**
   * When true, messages with sequence numbers greater than `after_seq` are
   * deleted before the new user/assistant messages are appended.
   */
  truncate_after?: boolean;
  messages: Array<{
    role: 'user';
    content: string | MessageContent;
  }>;
  /** Additional OpenAI-compatible parameters (model, max_tokens, tools, etc). */
  completion: Record<string, unknown>;
}

/**
 * Intent for editing an existing user message
 */
export interface EditMessageIntent extends BaseIntent {
  type: 'edit_message';
  /** The message that is being edited */
  message_id: string;
  /** Expected sequence number to enforce optimistic locking */
  expected_seq: number;
  /** New content for the user message */
  content: string | MessageContent;
}

/**
 * Union type of all intent types
 */
export type Intent = AppendMessageIntent | EditMessageIntent;

/**
 * Intent envelope that wraps all mutating requests
 */
export interface IntentEnvelope {
  intent: Intent;
}

/**
 * Success response from intent-based operations
 */
export interface IntentSuccessResponse {
  success: true;
  conversation_id: string;
  client_operation: string;
  operations: {
    inserted: Array<{ id: string; seq: number; role: string }>;
    updated: Array<{ id: string; seq: number; role: string }>;
    deleted: Array<{ id: string; seq: number; role: string }>;
  };
  fork_conversation_id?: string; // Present only for edit operations
  metadata?: Record<string, unknown>; // Echoes the original intent metadata when provided
}

/**
 * Error response from intent-based operations
 */
export interface IntentErrorResponse {
  success: false;
  error: 'validation_error';
  error_code: string;
  message: string;
  client_operation?: string;
  details?: {
    field: string;
    expected?: unknown;
    actual?: unknown;
  };
}

/**
 * Create an append_message intent envelope
 */
export function createAppendMessageIntent(params: {
  conversationId?: string;
  afterMessageId?: string;
  afterSeq?: number;
  truncateAfter?: boolean;
  messages: Array<{ role: 'user'; content: string | MessageContent }>;
  completion: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): IntentEnvelope {
  const clientOperation = generateClientOperation();

  const intent: AppendMessageIntent = {
    type: 'append_message',
    client_operation: clientOperation,
    messages: params.messages,
    completion: params.completion,
  };

  if (params.conversationId) {
    intent.conversation_id = params.conversationId;
  }

  if (params.afterMessageId) {
    intent.after_message_id = params.afterMessageId;
  }

  if (params.afterSeq !== undefined) {
    intent.after_seq = params.afterSeq;
  }

  if (params.truncateAfter !== undefined) {
    intent.truncate_after = params.truncateAfter;
  }

  if (params.metadata) {
    intent.metadata = params.metadata;
  }

  return { intent };
}

/**
 * Create an edit_message intent envelope
 */
export function createEditMessageIntent(params: {
  conversationId?: string;
  messageId: string;
  expectedSeq: number;
  content: string | MessageContent;
  metadata?: Record<string, unknown>;
}): IntentEnvelope {
  const clientOperation = generateClientOperation();

  const intent: EditMessageIntent = {
    type: 'edit_message',
    client_operation: clientOperation,
    message_id: params.messageId,
    expected_seq: params.expectedSeq,
    content: params.content,
  };

  if (params.conversationId) {
    intent.conversation_id = params.conversationId;
  }

  if (params.metadata) {
    intent.metadata = params.metadata;
  }

  return { intent };
}

/**
 * Check if a response is an intent success response
 */
export function isIntentSuccessResponse(data: any): data is IntentSuccessResponse {
  return data && data.success === true && 'client_operation' in data && 'operations' in data;
}

/**
 * Check if a response is an intent error response
 */
export function isIntentErrorResponse(data: any): data is IntentErrorResponse {
  return data && data.success === false && 'error_code' in data;
}
