import { getDb } from './client.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * List custom system prompts for a user
 * @param {string} userId - User ID
 * @returns {Array} Array of custom prompts ordered by last_used_at DESC
 */
export function listCustomPrompts(userId) {
  const db = getDb();
  const query = `
    SELECT id, name, body, usage_count, last_used_at, created_at, updated_at
    FROM system_prompts
    WHERE user_id = @userId
    ORDER BY last_used_at DESC NULLS LAST, created_at DESC
  `;

  return db.prepare(query).all({ userId });
}

/**
 * Get a custom prompt by ID and user
 * @param {string} id - Prompt ID
 * @param {string} userId - User ID
 * @returns {Object|null} Prompt object or null if not found
 */
export function getCustomPromptById(id, userId) {
  const db = getDb();
  const query = `
    SELECT id, name, body, usage_count, last_used_at, created_at, updated_at
    FROM system_prompts
    WHERE id = @id AND user_id = @userId
  `;

  return db.prepare(query).get({ id, userId });
}

/**
 * Create a new custom prompt
 * @param {Object} prompt - Prompt data
 * @param {string} prompt.name - Prompt name
 * @param {string} prompt.body - Prompt body
 * @param {string} userId - User ID
 * @returns {Object} Created prompt
 */
export function createCustomPrompt({ name, body }, userId) {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  // Handle name uniqueness with suffix
  const uniqueName = ensureUniqueName(name, userId);

  const query = `
    INSERT INTO system_prompts (id, user_id, name, body, usage_count, last_used_at, created_at, updated_at)
    VALUES (@id, @userId, @name, @body, 0, NULL, @now, @now)
  `;

  db.prepare(query).run({
    id,
    userId,
    name: uniqueName,
    body,
    now
  });

  return getCustomPromptById(id, userId);
}

/**
 * Update a custom prompt
 * @param {string} id - Prompt ID
 * @param {Object} updates - Updates to apply
 * @param {string} userId - User ID
 * @returns {Object|null} Updated prompt or null if not found
 */
export function updateCustomPrompt(id, updates, userId) {
  const db = getDb();
  const current = getCustomPromptById(id, userId);

  if (!current) return null;

  const now = new Date().toISOString();
  const fieldsToUpdate = [];
  const params = { id, userId, now };

  if (updates.name !== undefined) {
    // Check for name uniqueness excluding current prompt
    const uniqueName = ensureUniqueName(updates.name, userId, id);
    fieldsToUpdate.push('name = @name');
    params.name = uniqueName;
  }

  if (updates.body !== undefined) {
    fieldsToUpdate.push('body = @body');
    params.body = updates.body;
  }

  if (fieldsToUpdate.length === 0) return current;

  fieldsToUpdate.push('updated_at = @now');

  const query = `
    UPDATE system_prompts
    SET ${fieldsToUpdate.join(', ')}
    WHERE id = @id AND user_id = @userId
  `;

  db.prepare(query).run(params);
  return getCustomPromptById(id, userId);
}

/**
 * Delete a custom prompt
 * @param {string} id - Prompt ID
 * @param {string} userId - User ID
 * @returns {boolean} True if deleted, false if not found
 */
export function deleteCustomPrompt(id, userId) {
  const db = getDb();

  const query = `DELETE FROM system_prompts WHERE id = @id AND user_id = @userId`;
  const info = db.prepare(query).run({ id, userId });

  if (info.changes > 0) {
    // Clear this prompt from any conversation metadata
    clearPromptFromConversations(id);
    return true;
  }

  return false;
}

/**
 * Duplicate a prompt (create a copy)
 * @param {string} sourceId - Source prompt ID (custom or built-in)
 * @param {Object} sourcePrompt - Source prompt data
 * @param {string} userId - User ID
 * @returns {Object} New custom prompt
 */
export function duplicatePrompt(sourcePrompt, userId) {
  const baseName = sourcePrompt.name;
  const body = sourcePrompt.body;

  return createCustomPrompt({ name: baseName, body }, userId);
}

/**
 * Update usage statistics for a prompt
 * @param {string} id - Prompt ID
 * @param {string} userId - User ID
 */
export function updatePromptUsage(id, userId) {
  const db = getDb();
  const now = new Date().toISOString();

  const query = `
    UPDATE system_prompts
    SET usage_count = usage_count + 1, last_used_at = @now
    WHERE id = @id AND user_id = @userId
  `;

  db.prepare(query).run({ id, userId, now });
}

/**
 * Ensure name uniqueness by adding suffix if needed
 * @param {string} name - Desired name
 * @param {string} userId - User ID
 * @param {string} excludeId - ID to exclude from uniqueness check
 * @returns {string} Unique name (possibly with suffix)
 */
function ensureUniqueName(name, userId, excludeId = null) {
  const db = getDb();
  const baseName = name.trim();

  // Check if base name is available
  let query = `
    SELECT COUNT(*) as count
    FROM system_prompts
    WHERE user_id = @userId AND LOWER(TRIM(name)) = LOWER(@name)
  `;
  let params = { userId, name: baseName };

  if (excludeId) {
    query += ` AND id != @excludeId`;
    params.excludeId = excludeId;
  }

  const existing = db.prepare(query).get(params);

  if (existing.count === 0) {
    return baseName;
  }

  // Find next available suffix
  let suffix = 1;
  while (true) {
    const candidateName = `${baseName} (${suffix})`;
    query = `
      SELECT COUNT(*) as count
      FROM system_prompts
      WHERE user_id = @userId AND LOWER(TRIM(name)) = LOWER(@name)
    `;
    params = { userId, name: candidateName };

    if (excludeId) {
      query += ` AND id != @excludeId`;
      params.excludeId = excludeId;
    }

    const candidateCheck = db.prepare(query).get(params);

    if (candidateCheck.count === 0) {
      return candidateName;
    }

    suffix++;
  }
}

/**
 * Clear a prompt ID from all conversation metadata
 * @param {string} promptId - Prompt ID to clear
 */
function clearPromptFromConversations(promptId) {
  const db = getDb();

  // Get conversations that have this prompt as active
  const conversationsQuery = `
    SELECT id, metadata
    FROM conversations
    WHERE json_extract(metadata, '$.active_system_prompt_id') = @promptId
  `;

  const conversations = db.prepare(conversationsQuery).all({ promptId });

  // Update each conversation to remove the active prompt
  const updateQuery = `
    UPDATE conversations
    SET metadata = json_remove(metadata, '$.active_system_prompt_id')
    WHERE id = @conversationId
  `;

  const updateStmt = db.prepare(updateQuery);

  for (const conv of conversations) {
    updateStmt.run({ conversationId: conv.id });
  }
}