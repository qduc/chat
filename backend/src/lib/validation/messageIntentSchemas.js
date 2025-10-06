import { z } from 'zod';

// Mixed content types for messages (string or structured content array)
const textContentSchema = z.object({
  type: z.literal('text'),
  text: z.string()
});

const imageContentSchema = z.object({
  type: z.literal('image_url'),
  image_url: z.union([
    z.string(),
    z.object({
      url: z.string(),
      detail: z.enum(['auto', 'low', 'high']).optional()
    })
  ])
});

const mixedContentSchema = z.array(
  z.union([textContentSchema, imageContentSchema])
);

const messageContentSchema = z.union([
  z.string(),
  mixedContentSchema
]);

// Base intent fields
const baseIntentFields = {
  client_operation: z.string()
    .min(1, 'client_operation is required'),
  conversation_id: z.string()
    .uuid('conversation_id must be a valid UUID')
    .optional(),
  metadata: z.record(z.unknown()).optional()
};

// Append message intent
export const appendMessageIntentSchema = z.object({
  type: z.literal('append_message'),
  ...baseIntentFields,
  after_message_id: z.string()
    .optional(),
  after_seq: z.number()
    .int()
    .positive('after_seq must be a positive integer')
    .optional(),
  truncate_after: z.boolean()
    .optional()
    .default(false),
  messages: z.array(
    z.object({
      role: z.literal('user'),
      content: messageContentSchema
    })
  ).min(1, 'At least one message is required'),
  completion: z.record(z.unknown())
}).refine(
  data => {
    // If conversation_id is provided, after_message_id and after_seq must be provided
    if (data.conversation_id && (!data.after_message_id || data.after_seq === undefined)) {
      return false;
    }
    return true;
  },
  {
    message: 'When conversation_id is provided, both after_message_id and after_seq are required'
  }
).refine(
  data => {
    // If after_message_id is provided, after_seq must also be provided
    if (data.after_message_id && data.after_seq === undefined) {
      return false;
    }
    if (data.after_seq !== undefined && !data.after_message_id) {
      return false;
    }
    return true;
  },
  {
    message: 'after_message_id and after_seq must be provided together'
  }
);

// Edit message intent
export const editMessageIntentSchema = z.object({
  type: z.literal('edit_message'),
  ...baseIntentFields,
  message_id: z.string()
    .uuid('message_id must be a valid UUID'),
  expected_seq: z.number()
    .int()
    .positive('expected_seq must be a positive integer'),
  content: messageContentSchema
});

// Union of all intent types
export const intentSchema = z.union([
  appendMessageIntentSchema,
  editMessageIntentSchema
]);

// Intent envelope (wraps the request)
export const intentEnvelopeSchema = z.object({
  intent: intentSchema
});

// Response schemas
const operationRecordSchema = z.object({
  id: z.string().uuid(),
  seq: z.number().int().positive(),
  role: z.string()
});

export const intentSuccessResponseSchema = z.object({
  success: z.literal(true),
  conversation_id: z.string().uuid(),
  client_operation: z.string(),
  operations: z.object({
    inserted: z.array(operationRecordSchema),
    updated: z.array(operationRecordSchema),
    deleted: z.array(operationRecordSchema)
  }),
  fork_conversation_id: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional()
});

export const intentErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.literal('validation_error'),
  error_code: z.string(),
  message: z.string(),
  client_operation: z.string().optional(),
  details: z.object({
    field: z.string(),
    expected: z.unknown().optional(),
    actual: z.unknown().optional()
  }).optional()
});

// Validation helper functions
export function validateAppendMessageIntent(data) {
  return appendMessageIntentSchema.parse(data);
}

export function validateEditMessageIntent(data) {
  return editMessageIntentSchema.parse(data);
}

export function validateIntent(data) {
  return intentSchema.parse(data);
}

export function validateIntentEnvelope(data) {
  return intentEnvelopeSchema.parse(data);
}

// Error factory functions
export function createIntentError(errorCode, message, clientOperation, details) {
  const error = {
    success: false,
    error: 'validation_error',
    error_code: errorCode,
    message
  };
  
  if (clientOperation) {
    error.client_operation = clientOperation;
  }
  
  if (details) {
    error.details = details;
  }
  
  return error;
}

export function createIntentSuccess(conversationId, clientOperation, operations, metadata, forkConversationId) {
  const response = {
    success: true,
    conversation_id: conversationId,
    client_operation: clientOperation,
    operations: {
      inserted: operations.inserted || [],
      updated: operations.updated || [],
      deleted: operations.deleted || []
    }
  };
  
  if (forkConversationId) {
    response.fork_conversation_id = forkConversationId;
  }
  
  if (metadata) {
    response.metadata = metadata;
  }
  
  return response;
}
