import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { logger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cache for built-in prompts
let builtInPromptsCache = null;
let loadError = null;

/**
 * Load all shared modules from the _modules directory
 * @param {string} builtinsDir - Path to builtins directory
 * @returns {string} Concatenated module content
 */
async function loadSharedModules(builtinsDir) {
  const modulesDir = join(builtinsDir, '_modules');

  try {
    const files = await readdir(modulesDir);
    const moduleFiles = files.filter(file => file.endsWith('.md'));

    if (moduleFiles.length === 0) {
      return '';
    }

    const moduleContents = [];
    for (const file of moduleFiles) {
      try {
        const filePath = join(modulesDir, file);
        const content = await readFile(filePath, 'utf-8');
        moduleContents.push(content.trim());
      } catch (error) {
        logger.warn(`[builtins] Failed to load module ${file}: ${error.message}`);
      }
    }

    return moduleContents.length > 0 ? '\n\n' + moduleContents.join('\n\n') : '';
  } catch (error) {
    // _modules directory doesn't exist or is inaccessible
    if (error.code === 'ENOENT') {
      return '';
    }
    logger.warn(`[builtins] Failed to load shared modules: ${error.message}`);
    return '';
  }
}

/**
 * Load and parse a markdown file with YAML front-matter
 * @param {string} filePath - Path to the markdown file
 * @param {string} builtinsDir - Path to builtins directory
 * @param {string} sharedModules - Shared modules content
 * @returns {Object} Parsed prompt object
 */
async function parsePromptFile(filePath, builtinsDir, sharedModules = '') {
  const content = await readFile(filePath, 'utf-8');

  // Check if file has YAML front-matter
  if (!content.startsWith('---')) {
    throw new Error(`File ${filePath} does not have YAML front-matter`);
  }

  // Split front-matter and body
  const parts = content.split('---');
  if (parts.length < 3) {
    throw new Error(`File ${filePath} has invalid YAML front-matter format`);
  }

  // Parse YAML front-matter (skip first empty part)
  const frontMatterText = parts[1];
  const bodyText = parts.slice(2).join('---').trim();

  let frontMatter;
  try {
    frontMatter = yaml.load(frontMatterText);
  } catch (error) {
    throw new Error(`Failed to parse YAML front-matter in ${filePath}: ${error.message}`);
  }

  // Validate required fields
  const required = ['slug', 'name', 'order'];
  for (const field of required) {
    if (!frontMatter[field]) {
      throw new Error(`Missing required field '${field}' in ${filePath}`);
    }
  }

  // Validate types
  if (typeof frontMatter.slug !== 'string') {
    throw new Error(`Field 'slug' must be a string in ${filePath}`);
  }
  if (typeof frontMatter.name !== 'string') {
    throw new Error(`Field 'name' must be a string in ${filePath}`);
  }
  if (typeof frontMatter.order !== 'number') {
    throw new Error(`Field 'order' must be a number in ${filePath}`);
  }

  // Construct full body with structure:
  // <system_instructions>date + shared modules</system_instructions>
  // <user_instructions>prompt body</user_instructions>
  let fullBody = '';

  // Build system_instructions section with date and shared modules
  const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  let systemInstructions = `Today's date: ${currentDate}`;

  if (sharedModules) {
    systemInstructions += `\n\n${sharedModules.trim()}`;
  }

  fullBody = `<system_instructions>\n${systemInstructions}\n</system_instructions>\n\n<user_instructions>\n${bodyText}\n</user_instructions>`;

  return {
    id: `built:${frontMatter.slug}`,
    slug: frontMatter.slug,
    name: frontMatter.name,
    description: frontMatter.description || '',
    order: frontMatter.order,
    body: fullBody,
    user_instructions: bodyText, // Store separately for API response
    read_only: true
  };
}

/**
 * Load all built-in prompts from markdown files
 * @returns {Array} Array of built-in prompt objects
 */
async function loadBuiltInPrompts() {
  try {
    const builtinsDir = join(__dirname, '..', 'prompts', 'builtins');

    let files;
    try {
      files = await readdir(builtinsDir);
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.warn('[builtins] Built-ins directory not found, no built-in prompts available');
        return [];
      }
      throw error;
    }

    // Filter markdown files (exclude README.md)
    const markdownFiles = files.filter(file =>
      file.endsWith('.md') && file !== 'README.md'
    );

    if (markdownFiles.length === 0) {
      logger.warn('[builtins] No built-in prompt files found');
      return [];
    }

    // Load shared modules once
    const sharedModules = await loadSharedModules(builtinsDir);

    const prompts = [];
    const errors = [];

    // Load each markdown file
    for (const file of markdownFiles) {
      try {
        const filePath = join(builtinsDir, file);
        const prompt = await parsePromptFile(filePath, builtinsDir, sharedModules);

        prompts.push(prompt);
      } catch (error) {
        logger.error(`[builtins] Failed to load ${file}:`, error.message);
        errors.push({ file, error: error.message });
      }
    }

    // Sort by order field
    prompts.sort((a, b) => a.order - b.order);

    if (errors.length > 0) {
      logger.warn(`[builtins] Loaded ${prompts.length} prompts with ${errors.length} errors`);
    } else {
      logger.info(`[builtins] Loaded ${prompts.length} built-in prompts`);
    }

    return prompts;

  } catch (error) {
    logger.error('[builtins] Failed to load built-in prompts:', error.message);
    throw error;
  }
}

/**
 * Get all built-in prompts (cached)
 * @returns {Array} Array of built-in prompt objects
 */
export async function getBuiltInPrompts() {
  if (builtInPromptsCache === null) {
    try {
      builtInPromptsCache = await loadBuiltInPrompts();
      loadError = null;
    } catch (error) {
      loadError = error;
      builtInPromptsCache = []; // Return empty array on error
    }
  }

  return builtInPromptsCache;
}

/**
 * Get a built-in prompt by slug
 * @param {string} slug - Prompt slug
 * @returns {Object|null} Prompt object or null if not found
 */
export async function getBuiltInPromptBySlug(slug) {
  const prompts = await getBuiltInPrompts();
  return prompts.find(p => p.slug === slug) || null;
}

/**
 * Get a built-in prompt by ID (built:slug format)
 * @param {string} id - Prompt ID in format "built:slug"
 * @returns {Object|null} Prompt object or null if not found
 */
export async function getBuiltInPromptById(id) {
  if (!id.startsWith('built:')) {
    return null;
  }

  const slug = id.slice(6); // Remove "built:" prefix
  return await getBuiltInPromptBySlug(slug);
}

/**
 * Check if there was an error loading built-ins
 * @returns {Error|null} Load error or null if no error
 */
export function getLoadError() {
  return loadError;
}

/**
 * Clear the cache (useful for testing or reloading)
 */
export function clearCache() {
  builtInPromptsCache = null;
  loadError = null;
}

/**
 * Validate that a slug is valid for built-ins
 * @param {string} slug - Slug to validate
 * @returns {boolean} True if valid
 */
export function isValidSlug(slug) {
  // Allow alphanumeric, hyphens, underscores
  return /^[a-z0-9_-]+$/.test(slug);
}