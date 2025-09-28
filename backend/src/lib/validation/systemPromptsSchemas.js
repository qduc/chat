import { z } from 'zod';

// Schema for creating a new custom prompt
export const createPromptSchema = z.object({
  name: z.string()
    .trim()
    .min(1, 'Name is required')
    .max(255, 'Name must be 255 characters or less'),
  body: z.string()
    .trim()
    .min(1, 'Body is required')
});

// Schema for updating a custom prompt
export const updatePromptSchema = z.object({
  name: z.string()
    .trim()
    .min(1, 'Name cannot be empty')
    .max(255, 'Name must be 255 characters or less')
    .optional(),
  body: z.string()
    .trim()
    .min(1, 'Body cannot be empty')
    .optional()
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update'
});

// Schema for selecting a prompt for a conversation
export const selectPromptSchema = z.object({
  conversation_id: z.string()
    .min(1, 'Conversation ID is required'),
  inline_override: z.string()
    .trim()
    .optional()
    .nullable()
});

// Schema for clearing prompt selection
export const clearSelectionSchema = z.object({
  conversation_id: z.string()
    .min(1, 'Conversation ID is required')
});

// Schema for prompt ID parameter validation
export const promptIdSchema = z.string()
  .min(1, 'Prompt ID is required');

// Schema for validating built-in prompt ID format
export const builtInPromptIdSchema = z.string()
  .regex(/^built:[a-z0-9_-]+$/, 'Invalid built-in prompt ID format');

// Schema for validating custom prompt ID format (UUID)
export const customPromptIdSchema = z.string()
  .uuid('Invalid custom prompt ID format');

// Combined prompt ID schema (built-in or custom)
export const anyPromptIdSchema = z.string()
  .refine(id => {
    return builtInPromptIdSchema.safeParse(id).success ||
           customPromptIdSchema.safeParse(id).success;
  }, 'Invalid prompt ID format');

// Schema for response validation (built-in prompt)
export const builtInPromptResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  order: z.number(),
  body: z.string(),
  read_only: z.literal(true)
});

// Schema for response validation (custom prompt)
export const customPromptResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  body: z.string(),
  usage_count: z.number().int().min(0),
  last_used_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

// Schema for list prompts response
export const listPromptsResponseSchema = z.object({
  built_ins: z.array(builtInPromptResponseSchema),
  custom: z.array(customPromptResponseSchema)
});

// Schema for conversation selection result
export const conversationSelectionResultSchema = z.object({
  conversation_id: z.string(),
  active_system_prompt_id: z.string().nullable()
});

// Validation helper functions
export function validateCreatePrompt(data) {
  return createPromptSchema.parse(data);
}

export function validateUpdatePrompt(data) {
  return updatePromptSchema.parse(data);
}

export function validateSelectPrompt(data) {
  return selectPromptSchema.parse(data);
}

export function validateClearSelection(data) {
  return clearSelectionSchema.parse(data);
}

export function validatePromptId(id) {
  return promptIdSchema.parse(id);
}

export function validateAnyPromptId(id) {
  return anyPromptIdSchema.parse(id);
}

export function isBuiltInPromptId(id) {
  return builtInPromptIdSchema.safeParse(id).success;
}

export function isCustomPromptId(id) {
  return customPromptIdSchema.safeParse(id).success;
}