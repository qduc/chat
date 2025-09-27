import * as systemPromptsDb from '../db/systemPrompts.js';
import { getBuiltInPrompts, getBuiltInPromptById, getLoadError } from './builtInsPromptLoader.js';
import { isBuiltInPromptId } from './validation/systemPromptsSchemas.js';
import { logger } from '../logger.js';

export class PromptServiceError extends Error {
  constructor(message, { status = 500, code = 'prompt_error' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Get combined list of built-in and custom prompts for a user
 * Performance note (2025-09-27): p95 ≈ 33ms (avg ≈ 7.5ms) across 10 iterations
 *   measured via `backend/__tests__/system_prompts.performance.list.test.js`.
 * @param {string} userId - User ID
 * @returns {Object} Object with built_ins and custom arrays
 */
export async function listAllPrompts(userId) {
  try {
    // Load built-ins (cached)
    const builtIns = await getBuiltInPrompts();

    // Load custom prompts for user
    const custom = systemPromptsDb.listCustomPrompts(userId);

    return {
      built_ins: builtIns,
      custom: custom,
      error: getLoadError() ? 'Failed to load some built-in prompts' : null
    };
  } catch (error) {
    // SECURITY: Never log prompt bodies or user-provided content.
    logger.error({
      msg: 'system_prompts:list_failed',
      error: {
        name: error?.name || 'Error',
        message: error?.message || 'Unknown error'
      }
    });

    // Return custom prompts even if built-ins fail
    const custom = systemPromptsDb.listCustomPrompts(userId);

    return {
      built_ins: [],
      custom: custom,
      error: 'Failed to load built-in prompts'
    };
  }
}

/**
 * Get a prompt by ID (built-in or custom)
 * @param {string} id - Prompt ID
 * @param {string} userId - User ID
 * @returns {Object|null} Prompt object or null if not found
 */
export async function getPromptById(id, userId) {
  if (isBuiltInPromptId(id)) {
    return await getBuiltInPromptById(id);
  } else {
    return systemPromptsDb.getCustomPromptById(id, userId);
  }
}

/**
 * Create a new custom prompt
 * @param {Object} promptData - Prompt data
 * @param {string} userId - User ID
 * @returns {Object} Created prompt
 */
export function createCustomPrompt(promptData, userId) {
  return systemPromptsDb.createCustomPrompt(promptData, userId);
}

/**
 * Update a custom prompt
 * @param {string} id - Prompt ID
 * @param {Object} updates - Updates to apply
 * @param {string} userId - User ID
 * @returns {Object|null} Updated prompt or null if not found/not allowed
 */
export function updateCustomPrompt(id, updates, userId) {
  // Prevent updating built-in prompts
  if (isBuiltInPromptId(id)) {
    throw new PromptServiceError('Built-in prompts are read-only', {
      status: 400,
      code: 'read_only'
    });
  }

  return systemPromptsDb.updateCustomPrompt(id, updates, userId);
}

/**
 * Delete a custom prompt
 * @param {string} id - Prompt ID
 * @param {string} userId - User ID
 * @returns {boolean} True if deleted, false if not found/not allowed
 */
export function deleteCustomPrompt(id, userId) {
  // Prevent deleting built-in prompts
  if (isBuiltInPromptId(id)) {
    throw new PromptServiceError('Built-in prompts cannot be deleted', {
      status: 400,
      code: 'read_only'
    });
  }

  return systemPromptsDb.deleteCustomPrompt(id, userId);
}

/**
 * Duplicate a prompt (built-in or custom) as a new custom prompt
 * @param {string} sourceId - Source prompt ID
 * @param {string} userId - User ID
 * @returns {Object|null} New custom prompt or null if source not found
 */
export async function duplicatePrompt(sourceId, userId) {
  const sourcePrompt = await getPromptById(sourceId, userId);

  if (!sourcePrompt) {
    return null;
  }

  return systemPromptsDb.duplicatePrompt(sourcePrompt, userId);
}

/**
 * Update conversation metadata to set active prompt
 * @param {string} promptId - Prompt ID to set as active
 * @param {string} conversationId - Conversation ID
 * @param {string} userId - User ID
 * @param {string} inlineOverride - Optional inline override content
 * @returns {Object} Selection result
 */
export async function selectPromptForConversation(
  promptId,
  conversationId,
  { userId, sessionId, inlineOverride = null } = {}
) {
  if (!userId && !sessionId) {
    throw new PromptServiceError('Conversation context required', {
      status: 400,
      code: 'conversation_context_required'
    });
  }

  // Verify prompt exists and user has access
  const prompt = await getPromptById(promptId, userId);
  if (!prompt) {
    throw new PromptServiceError('Prompt not found', {
      status: 404,
      code: 'not_found'
    });
  }

  // Update conversation metadata
  await updateConversationActivePrompt(conversationId, userId, sessionId, promptId, inlineOverride);

  return {
    conversation_id: conversationId,
    active_system_prompt_id: promptId
  };
}

/**
 * Clear active prompt from conversation
 * @param {string} conversationId - Conversation ID
 * @returns {Object} Clear result
 */
export async function clearPromptFromConversation(conversationId, { userId, sessionId } = {}) {
  if (!userId && !sessionId) {
    throw new PromptServiceError('Conversation context required', {
      status: 400,
      code: 'conversation_context_required'
    });
  }

  await updateConversationActivePrompt(conversationId, userId, sessionId, null, null);

  return {
    conversation_id: conversationId,
    active_system_prompt_id: null
  };
}

/**
 * Get effective prompt text for a conversation (including inline overrides)
 * @param {string} conversationId - Conversation ID
 * @param {string} userId - User ID
 * @param {string} inlineOverride - Optional inline override content
 * @returns {string|null} Effective prompt text or null if no prompt
 */
export async function getEffectivePromptText(
  conversationId,
  { userId, sessionId } = {},
  inlineOverride = null
) {
  // If inline override provided, use it directly
  if (inlineOverride && inlineOverride.trim()) {
    return inlineOverride.trim();
  }

  // Get active prompt from conversation metadata
  const { promptId: activePromptId, inlineOverride: storedInline } = await getConversationPromptContext(
    conversationId,
    userId,
    sessionId
  );

  if (storedInline && storedInline.trim()) {
    return storedInline.trim();
  }

  if (!activePromptId) {
    return null;
  }

  // Get prompt content
  const prompt = await getPromptById(activePromptId, userId);
  if (!prompt) {
    return null;
  }

  return prompt.body;
}

/**
 * Update usage statistics after successful message send
 * @param {string} conversationId - Conversation ID
 * @param {string} userId - User ID
 * @param {string} inlineOverride - Optional inline override content
 */
export async function updateUsageAfterSend(
  conversationId,
  { userId, sessionId } = {},
  inlineOverride = null
) {
  // Only update usage if no inline override (using stored prompt)
  if (inlineOverride && inlineOverride.trim()) {
    return; // Using inline override, don't update stored prompt usage
  }

  const { promptId: activePromptId } = await getConversationPromptContext(
    conversationId,
    userId,
    sessionId
  );
  if (!activePromptId || isBuiltInPromptId(activePromptId)) {
    return; // No prompt or built-in prompt - don't update usage
  }

  if (!userId) {
    return;
  }

  // Update usage for custom prompt
  systemPromptsDb.updatePromptUsage(activePromptId, userId);
}

/**
 * Helper to update conversation metadata with active prompt
 * @private
 */
async function updateConversationActivePrompt(
  conversationId,
  userId,
  sessionId,
  promptId,
  inlineOverride
) {
  // Import conversations module to update metadata
  const { updateConversationMetadata } = await import('../db/conversations.js');

  const patch = {};
  if (promptId !== undefined) {
    patch.active_system_prompt_id = promptId;
  }

  if (inlineOverride !== undefined) {
    patch.inline_system_prompt_override = inlineOverride && inlineOverride.trim()
      ? inlineOverride.trim()
      : null;
  }

  await updateConversationMetadata({
    id: conversationId,
    sessionId: sessionId || null,
    userId: userId || null,
    patch
  });
}

/**
 * Helper to get active prompt from conversation metadata
 * @private
 */
async function getConversationPromptContext(conversationId, userId, sessionId) {
  // Import conversations module to get metadata
  const { getConversationById } = await import('../db/conversations.js');

  if (!userId && !sessionId) {
    return { promptId: null, inlineOverride: null };
  }

  const conversation = await getConversationById({
    id: conversationId,
    sessionId: sessionId || null,
    userId: userId || null
  });
  if (!conversation || !conversation.metadata) {
    return { promptId: null, inlineOverride: null };
  }

  const metadata = conversation.metadata;

  return {
    promptId: metadata.active_system_prompt_id || null,
    inlineOverride: metadata.inline_system_prompt_override || null
  };
}