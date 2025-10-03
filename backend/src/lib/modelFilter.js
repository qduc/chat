/**
 * Model filtering utility using wildcard patterns
 * Supports multiple patterns separated by semicolons
 *
 * Examples:
 *   "gpt-4*" - matches all models starting with "gpt-4"
 *   "*sonnet*" - matches all models containing "sonnet"
 *   "gemini/*" - matches all models starting with "gemini/"
 *   "gpt-4*; *sonnet*; gemini/*" - matches any of the patterns
 */

/**
 * Convert a wildcard pattern to a regex pattern
 * @param {string} pattern - Wildcard pattern (e.g., "gpt-4*", "*sonnet*")
 * @returns {RegExp} - Compiled regex
 */
function wildcardToRegex(pattern) {
  // Escape special regex characters except *
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // Replace * with .*
  const regexPattern = '^' + escaped.replace(/\*/g, '.*') + '$';
  return new RegExp(regexPattern, 'i'); // Case-insensitive
}

/**
 * Parse filter string into array of patterns
 * @param {string} filterString - Filter string with semicolon-separated patterns
 * @returns {string[]} - Array of trimmed patterns
 */
function parseFilterString(filterString) {
  if (!filterString || typeof filterString !== 'string') {
    return [];
  }

  return filterString
    .split(';')
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Check if a model matches any of the filter patterns
 * @param {string} modelId - Model ID to check
 * @param {string[]} patterns - Array of wildcard patterns
 * @returns {boolean} - True if model matches any pattern
 */
function matchesAnyPattern(modelId, patterns) {
  if (!patterns || patterns.length === 0) {
    return true; // No filter means include all
  }

  return patterns.some(pattern => {
    const regex = wildcardToRegex(pattern);
    return regex.test(modelId);
  });
}

/**
 * Filter models based on wildcard patterns
 * @param {Array<{id: string}>} models - Array of model objects with 'id' property
 * @param {string} filterString - Filter string with semicolon-separated patterns (e.g., "gpt-4*; *sonnet*")
 * @returns {Array<{id: string}>} - Filtered array of models
 */
export function filterModels(models, filterString) {
  if (!models || !Array.isArray(models)) {
    return [];
  }

  if (!filterString || typeof filterString !== 'string' || filterString.trim() === '') {
    return models; // No filter, return all models
  }

  const patterns = parseFilterString(filterString);

  if (patterns.length === 0) {
    return models; // No valid patterns, return all
  }

  return models.filter(model => {
    if (!model || !model.id) return false;
    return matchesAnyPattern(model.id, patterns);
  });
}

/**
 * Validate a filter string to ensure it's properly formatted
 * @param {string} filterString - Filter string to validate
 * @returns {{valid: boolean, error?: string}} - Validation result
 */
export function validateFilterString(filterString) {
  if (!filterString || typeof filterString !== 'string') {
    return { valid: true }; // Empty filter is valid
  }

  const trimmed = filterString.trim();
  if (trimmed === '') {
    return { valid: true };
  }

  const patterns = parseFilterString(filterString);

  if (patterns.length === 0) {
    return { valid: false, error: 'No valid patterns found' };
  }

  // Check for obviously invalid patterns
  for (const pattern of patterns) {
    if (pattern.length > 200) {
      return { valid: false, error: 'Pattern too long (max 200 characters)' };
    }
  }

  return { valid: true };
}
