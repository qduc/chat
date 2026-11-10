import yaml from 'js-yaml';
import { tools as toolRegistry } from './tools.js';
import { getMessagesPage } from '../db/messages.js';
import { getConversationMetadata } from './responseUtils.js';
import { logger } from '../logger.js';

function debugLogMessages(label, messages, persistence) {
  try {
    const conversationId = persistence?.conversationId;
    const condensed = Array.isArray(messages)
      ? messages.map((msg) => ({
        role: msg?.role,
        hasToolCalls: Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0,
        toolCallIds: Array.isArray(msg?.tool_calls) ? msg.tool_calls.map((tc) => tc?.id) : undefined,
        toolCallCount: Array.isArray(msg?.tool_calls) ? msg.tool_calls.length : 0,
        toolOutputs: Array.isArray(msg?.tool_outputs)
          ? msg.tool_outputs.map((out) => ({ tool_call_id: out?.tool_call_id }))
          : undefined,
      }))
      : null;
    logger.debug(`[toolOrchestrationUtils] ${label}`, {
      conversationId,
      messageCount: Array.isArray(messages) ? messages.length : null,
      messages: condensed,
    });
  } catch (error) {
    logger.warn('[toolOrchestrationUtils] Failed to log messages', error);
  }
}

/**
 * Normalizes the provided message object by ensuring required properties are present
 * and filtering valid optional properties based on predefined rules.
 *
 * @param {Object} message - The message object to normalize.
 * @param {string} message.role - The role of the message (valid values: 'user', 'assistant', 'tool').
 * @param {string} [message.content] - The content of the message.
 * @param {Array} [message.tool_calls] - List of tool calls associated with the message.
 * @param {Array} [message.tool_outputs] - List of tool outputs associated with the message.
 * @param {string} [message.tool_call_id] - The identifier of the associated tool call, if any.
 * @param {string} [message.status] - The status of the message.
 *
 * @return {Object|null} Returns the normalized message object if valid; otherwise, returns null.
 */
function normalizeStoredMessage(message) {
  if (!message) return null;
  if (!['user', 'assistant', 'tool'].includes(message.role)) return null;

  // Skip in-progress assistant drafts (created before streaming starts) and
  // any assistant entries that are effectively empty. These drafts can be
  // fetched from the database when building the request body and would
  // otherwise appear as an empty assistant message sent upstream.
  const isStreamingAssistant = message.role === 'assistant' && message.status === 'streaming';
  const isErrorAssistant = message.role === 'assistant' && message.status === 'error';
  const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  const hasToolOutputs = Array.isArray(message.tool_outputs) && message.tool_outputs.length > 0;
  const isContentEmpty =
    message.content === '' ||
    message.content === null ||
    message.content === undefined ||
    (Array.isArray(message.content) && message.content.length === 0);
  const isEmptyAssistant = message.role === 'assistant' && isContentEmpty && !hasToolCalls && !hasToolOutputs;

  if (isStreamingAssistant || isErrorAssistant || isEmptyAssistant) {
    return null;
  }

  const normalized = {
    role: message.role,
    content: message.content ?? ''
  };

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    normalized.tool_calls = message.tool_calls;
  }

  if (Array.isArray(message.tool_outputs) && message.tool_outputs.length > 0) {
    normalized.tool_outputs = message.tool_outputs;
  }

  // Preserve reasoning_details for OpenRouter reasoning token continuity
  // See: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#preserving-reasoning-blocks
  if (Array.isArray(message.reasoning_details) && message.reasoning_details.length > 0) {
    normalized.reasoning_details = message.reasoning_details;
  }

  if (message.tool_call_id) {
    normalized.tool_call_id = message.tool_call_id;
  }

  if (message.status) {
    normalized.status = message.status;
  }

  return normalized;
}

/**
 * Check if any web search tools are enabled in the request
 * @param {Array} enabledTools - Array of tool specs or tool names that are enabled
 * @returns {boolean} True if at least one web search tool is enabled
 */
function hasWebSearchToolsEnabled(enabledTools) {
  if (!Array.isArray(enabledTools) || enabledTools.length === 0) {
    return false;
  }

  const webSearchToolNames = ['web_search', 'web_search_exa', 'web_search_searxng', 'web_search_firecrawl'];

  return enabledTools.some(tool => {
    // Handle both tool spec objects and simple tool names
    const toolName = typeof tool === 'string' ? tool : tool?.function?.name || tool?.name;
    return webSearchToolNames.includes(toolName);
  });
}

/**
 * Check if the journal tool is enabled in the request
 * @param {Array} enabledTools - Array of tool specs or tool names that are enabled
 * @returns {boolean} True if journal is enabled
 */
function hasJournalToolsEnabled(enabledTools) {
  if (!Array.isArray(enabledTools) || enabledTools.length === 0) return false;
  return enabledTools.some(tool => {
    const toolName = typeof tool === 'string' ? tool : tool?.function?.name || tool?.name;
    return toolName === 'journal';
  });
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function matchesModelPattern(pattern, model) {
  if (typeof pattern !== 'string' || typeof model !== 'string') {
    return false;
  }

  const normalizedPattern = pattern.toLowerCase();
  const normalizedModel = model.toLowerCase();
  const escapedSegments = normalizedPattern.split('*').map(segment => escapeRegExp(segment));
  const regex = new RegExp(`^${escapedSegments.join('.*')}$`);
  return regex.test(normalizedModel);
}

function shouldIncludeModule(metadata, { model } = {}) {
  if (!metadata || typeof metadata !== 'object') {
    return true;
  }

  if (metadata.models) {
    const patterns = Array.isArray(metadata.models) ? metadata.models : [metadata.models];
    const usablePatterns = patterns
      .filter(pattern => typeof pattern === 'string')
      .map(pattern => pattern.trim())
      .filter(Boolean);

    if (usablePatterns.length === 0) {
      return true;
    }

    if (!model) {
      return true;
    }

    return usablePatterns.some(pattern => matchesModelPattern(pattern, model));
  }

  return true;
}

function parseModuleContent(content, filePath) {
  if (typeof content !== 'string' || content.trim() === '') {
    return { metadata: {}, body: '' };
  }

  const normalized = content.replace(/\r\n/g, '\n');

  if (!normalized.startsWith('---\n')) {
    return { metadata: {}, body: normalized.trim() };
  }

  const frontMatterPattern = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
  const match = frontMatterPattern.exec(normalized);

  if (!match) {
    logger.warn(`[toolOrchestrationUtils] Invalid front-matter format in module ${filePath}, treating entire file as body`);
    return { metadata: {}, body: normalized.trim() };
  }

  const [, frontMatterText] = match;
  const bodyText = normalized.slice(match[0].length);

  let metadata = {};
  try {
    const parsed = yaml.load(frontMatterText) || {};
    metadata = typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (error) {
    logger.warn(`[toolOrchestrationUtils] Failed to parse front-matter in module ${filePath}: ${error.message}`);
    metadata = {};
  }

  return {
    metadata,
    body: bodyText.trim()
  };
}

/**
 * Load shared modules for all prompts
 * @param {Array} enabledTools - Array of enabled tools (optional)
 * @returns {Promise<string>} Shared modules content
 */
async function loadSharedModules({ enabledTools = null, model = null } = {}) {
  try {
    const { readdir, readFile } = await import('fs/promises');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const modulesDir = join(__dirname, '..', 'prompts', 'builtins', '_modules');

    try {
      const files = await readdir(modulesDir);
      const moduleFiles = files
        .filter(file => file.endsWith('.md'))
        .sort();

      if (moduleFiles.length === 0) {
        return '';
      }

  const hasWebSearch = hasWebSearchToolsEnabled(enabledTools);
  const hasJournal = hasJournalToolsEnabled(enabledTools);
      const moduleContents = [];

      for (const file of moduleFiles) {
        try {
          // Skip web_search module if no web search tools are enabled
          if (file === 'web_search.md' && !hasWebSearch) {
            logger.debug('[toolOrchestrationUtils] Skipping web_search module (no web search tools enabled)');
            continue;
          }

          // Skip journal module if no journal tool is enabled
          if (file === 'journal.md' && !hasJournal) {
            logger.debug('[toolOrchestrationUtils] Skipping journal module (journal tool not enabled)');
            continue;
          }

          const filePath = join(modulesDir, file);
          const content = await readFile(filePath, 'utf-8');
          const { metadata, body } = parseModuleContent(content, filePath);

          if (!body) {
            logger.debug(`[toolOrchestrationUtils] Skipping module ${file} (empty body)`);
            continue;
          }

          if (!shouldIncludeModule(metadata, { model })) {
            logger.debug(`[toolOrchestrationUtils] Skipping module ${file} for model '${model || 'unknown'}'`);
            continue;
          }

          moduleContents.push(body);
        } catch (error) {
          logger.warn(`[toolOrchestrationUtils] Failed to load module ${file}: ${error.message}`);
        }
      }

      return moduleContents.length > 0 ? moduleContents.join('\n\n') : '';
    } catch (error) {
      if (error.code === 'ENOENT') {
        return '';
      }
      logger.warn('[toolOrchestrationUtils] Failed to load shared modules:', error);
      return '';
    }
  } catch (error) {
    logger.warn('[toolOrchestrationUtils] Failed to import shared modules:', error);
    return '';
  }
}

/**
 * Wrap prompt content with full structure (system_instructions + user_instructions)
 * @param {string} promptContent - The prompt content to wrap
 * @param {Array} enabledTools - Array of enabled tools (optional)
 * @returns {Promise<string>} Prompt with full structure
 */
async function wrapPromptWithStructure(promptContent, options = {}) {
  if (!promptContent) return promptContent;

  const { enabledTools = null, model = null } = options;

  // Check if already has the structure
  if (promptContent.includes('<system_instructions>') && promptContent.includes('<user_instructions>')) {
    return promptContent;
  }

  const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  const sharedModules = await loadSharedModules({ enabledTools, model });

  let systemInstructions = `Today's date: ${currentDate}`;
  if (sharedModules) {
    systemInstructions += `\n\n${sharedModules}`;
  }

  return `<system_instructions>\n${systemInstructions}\n</system_instructions>\n\n<user_instructions>\n${promptContent}\n</user_instructions>`;
}

/**
 * Synchronous wrapper for prompts (for backwards compatibility)
 * Only wraps with date, doesn't include shared modules
 * @param {string} promptContent - The prompt content to wrap
 * @returns {string} Prompt with date in system_instructions
 */
function wrapPromptWithDate(promptContent) {
  if (!promptContent) return promptContent;

  // Check if already has the structure
  if (promptContent.includes('<system_instructions>') && promptContent.includes('<user_instructions>')) {
    return promptContent;
  }

  const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

  return `<system_instructions>\nToday's date: ${currentDate}\n</system_instructions>\n\n<user_instructions>\n${promptContent}\n</user_instructions>`;
}

/**
 * Resolve system prompt content from active system prompt ID
 * @param {string} activePromptId - The active system prompt ID
 * @param {string} userId - User ID for custom prompts
 * @param {Array} enabledTools - Array of enabled tools (optional)
 * @returns {Promise<string>} Resolved system prompt content with full structure
 */
async function resolveSystemPromptContent(activePromptId, userId, options = {}) {
  if (!activePromptId) {
    return '';
  }

  const { enabledTools = null, model = null } = options;

  try {
    const { getPromptById } = await import('./promptService.js');
    const prompt = await getPromptById(activePromptId, userId);
    const promptBody = prompt?.body || '';

    // All prompts (both built-in and custom) are wrapped at request time
    // This ensures consistent behavior and request-specific module inclusion
    return await wrapPromptWithStructure(promptBody, { enabledTools, model });
  } catch (error) {
    logger.warn('[toolOrchestrationUtils] Failed to resolve system prompt:', error);
    return '';
  }
}

export function extractSystemPrompt({ body, bodyIn, persistence }) {
  const hasSystemPromptField = Object.hasOwn(bodyIn || {}, 'systemPrompt')
    || Object.hasOwn(bodyIn || {}, 'system_prompt');

  const fromMessages = Array.isArray(body?.messages)
    ? body.messages.find((msg) => msg && msg.role === 'system' && typeof msg.content === 'string' && msg.content.trim())
    : null;
  if (fromMessages) {
    return wrapPromptWithDate(fromMessages.content.trim());
  }

  const fromBodyParam = typeof bodyIn?.systemPrompt === 'string'
    ? bodyIn.systemPrompt.trim()
    : (typeof bodyIn?.system_prompt === 'string' ? bodyIn.system_prompt.trim() : '');
  if (fromBodyParam) {
    return wrapPromptWithDate(fromBodyParam);
  }

  // Explicitly clearing system prompt should suppress persistence fallback
  if (hasSystemPromptField) {
    const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    return `<system_instructions>\nToday's date: ${currentDate}\n</system_instructions>`;
  }

  const fromPersistence = persistence?.conversationMeta?.metadata?.system_prompt;
  if (typeof fromPersistence === 'string' && fromPersistence.trim()) {
    // Check if this is a built-in prompt (already has structure) or needs wrapping
    const trimmed = fromPersistence.trim();
    if (trimmed.includes('<system_instructions>') && trimmed.includes('<user_instructions>')) {
      return trimmed; // Already structured (built-in prompt)
    }
    return wrapPromptWithDate(trimmed);
  }

  // Even when no user-provided system prompt exists, inject a minimal system
  // instructions block with the current date so the model always knows the date.
  const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  return `<system_instructions>\nToday's date: ${currentDate}\n</system_instructions>`;
}

/**
 * Extract system prompt with support for resolving active_system_prompt_id
 * @param {Object} params - Parameters object
 * @param {Object} params.body - Request body
 * @param {Object} params.bodyIn - Input body
 * @param {Object} params.persistence - Persistence instance
 * @param {string} params.userId - User ID for resolving custom prompts
 * @returns {Promise<string>} Resolved system prompt content
 */
export async function extractSystemPromptAsync({ body, bodyIn, persistence, userId }) {
  const hasSystemPromptField = Object.hasOwn(bodyIn || {}, 'systemPrompt')
    || Object.hasOwn(bodyIn || {}, 'system_prompt');
  const hasActiveSystemPromptIdField = Object.hasOwn(bodyIn || {}, 'active_system_prompt_id');

  // Extract enabled tools from the request body
  const enabledTools = Array.isArray(body?.tools) ? body.tools : null;
  const candidateModels = [];

  const modelFromBody = typeof body?.model === 'string' ? body.model.trim() : '';
  if (modelFromBody) candidateModels.push(modelFromBody);

  const modelFromBodyIn = typeof bodyIn?.model === 'string' ? bodyIn.model.trim() : '';
  if (modelFromBodyIn) candidateModels.push(modelFromBodyIn);

  const modelFromPersistence = typeof persistence?.conversationMeta?.metadata?.model === 'string'
    ? persistence.conversationMeta.metadata.model.trim()
    : '';
  if (modelFromPersistence) candidateModels.push(modelFromPersistence);

  const model = candidateModels.length > 0 ? candidateModels[0] : null;

  // Check for inline overrides first (highest priority)
  const fromMessages = Array.isArray(body?.messages)
    ? body.messages.find((msg) => msg && msg.role === 'system' && typeof msg.content === 'string' && msg.content.trim())
    : null;
  if (fromMessages) {
    return wrapPromptWithStructure(fromMessages.content.trim(), { enabledTools, model });
  }

  const fromBodyParam = typeof bodyIn?.systemPrompt === 'string'
    ? bodyIn.systemPrompt.trim()
    : (typeof bodyIn?.system_prompt === 'string' ? bodyIn.system_prompt.trim() : '');
  if (fromBodyParam) {
    return wrapPromptWithStructure(fromBodyParam, { enabledTools, model });
  }

  // If system prompt field is explicitly present but empty/null, do not fall back to persistence
  const explicitlyClearedSystemPrompt = hasSystemPromptField;

  let activePromptId = null;
  if (hasActiveSystemPromptIdField) {
    activePromptId = typeof bodyIn?.active_system_prompt_id === 'string'
      ? bodyIn.active_system_prompt_id.trim()
      : '';
    activePromptId = activePromptId || null;
  } else {
    activePromptId = persistence?.conversationMeta?.metadata?.active_system_prompt_id || null;
  }

  // If there's an active system prompt ID, resolve it (prefer this over legacy stored prompt)
  if (activePromptId) {
    const resolvedContent = await resolveSystemPromptContent(activePromptId, userId, { enabledTools, model });
    if (resolvedContent) {
      return resolvedContent;
    }
  }

  if (explicitlyClearedSystemPrompt || (hasActiveSystemPromptIdField && !activePromptId)) {
    const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const sharedModules = await loadSharedModules({ enabledTools, model });

    let systemInstructions = `Today's date: ${currentDate}`;
    if (sharedModules) {
      systemInstructions += `\n\n${sharedModules}`;
    }

    return `<system_instructions>\n${systemInstructions}\n</system_instructions>`;
  }

  // Fall back to legacy stored system_prompt
  const fromPersistence = persistence?.conversationMeta?.metadata?.system_prompt;
  if (typeof fromPersistence === 'string' && fromPersistence.trim()) {
    const trimmed = fromPersistence.trim();
    if (trimmed.includes('<system_instructions>') && trimmed.includes('<user_instructions>')) {
      return trimmed; // Already structured
    }
    return wrapPromptWithStructure(trimmed, { enabledTools, model });
  }

  // Even when no user-provided system prompt exists, inject a minimal system
  // instructions block with the current date and shared modules so the model
  // always knows the current date.
  const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  const sharedModules = await loadSharedModules({ enabledTools, model });

  let systemInstructions = `Today's date: ${currentDate}`;
  if (sharedModules) {
    systemInstructions += `\n\n${sharedModules}`;
  }

  return `<system_instructions>\n${systemInstructions}\n</system_instructions>`;
}

export function buildConversationMessages({ body, bodyIn, persistence }) {
  const sanitizedMessages = Array.isArray(body?.messages) ? [...body.messages] : [];
  const nonSystemMessages = sanitizedMessages.filter((msg) => msg && msg.role !== 'system');
  const systemPrompt = extractSystemPrompt({ body, bodyIn, persistence });
  const hasPersistence = !!(persistence && persistence.persist && persistence.conversationId);

  if (nonSystemMessages.length > 0 && !hasPersistence) {
    const result = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...nonSystemMessages]
      : nonSystemMessages;
    debugLogMessages('buildConversationMessages(request)', result, persistence);
    return result;
  }

  let prior = [];
  if (persistence && persistence.persist && persistence.conversationId) {
    try {
      const page = getMessagesPage({ conversationId: persistence.conversationId, afterSeq: 0, limit: 200 });
      const messages = [];

      for (const m of page?.messages || []) {
        const normalized = normalizeStoredMessage(m);
        if (normalized) messages.push(normalized);
      }

      prior = messages;
    } catch {
      prior = Array.isArray(bodyIn?.messages)
        ? bodyIn.messages.filter((m) => m && m.role !== 'system')
        : [];
    }
  } else if (Array.isArray(bodyIn?.messages)) {
    prior = bodyIn.messages
      .filter((m) => m && m.role !== 'system')
      .map((m) => normalizeStoredMessage(m))
      .filter(Boolean);
  }

  const result = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...prior]
    : prior;
  debugLogMessages('buildConversationMessages(persistence)', result, persistence);
  return result;
}

/**
 * Build conversation messages with async system prompt resolution
 * @param {Object} params - Parameters object
 * @param {Object} params.body - Request body
 * @param {Object} params.bodyIn - Input body
 * @param {Object} params.persistence - Persistence instance
 * @param {string} params.userId - User ID for resolving custom prompts
 * @returns {Promise<Array>} Array of messages with resolved system prompt
 */
export async function buildConversationMessagesAsync({ body, bodyIn, persistence, userId }) {
  const sanitizedMessages = Array.isArray(body?.messages) ? [...body.messages] : [];
  const nonSystemMessages = sanitizedMessages.filter((msg) => msg && msg.role !== 'system');
  const systemPrompt = await extractSystemPromptAsync({ body, bodyIn, persistence, userId });
  const hasPersistence = !!(persistence && persistence.persist && persistence.conversationId);

  if (nonSystemMessages.length > 0 && !hasPersistence) {
    const result = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...nonSystemMessages]
      : nonSystemMessages;
    debugLogMessages('buildConversationMessagesAsync(request)', result, persistence);
    return result;
  }

  let prior = [];
  if (persistence && persistence.persist && persistence.conversationId) {
    try {
      const page = getMessagesPage({ conversationId: persistence.conversationId, afterSeq: 0, limit: 200 });
      const messages = [];

      for (const m of page?.messages || []) {
        const normalized = normalizeStoredMessage(m);
        if (normalized) messages.push(normalized);
      }

      prior = messages;
    } catch {
      prior = Array.isArray(bodyIn?.messages)
        ? bodyIn.messages
          .filter((m) => m && m.role !== 'system')
          .map((m) => normalizeStoredMessage(m))
          .filter(Boolean)
        : [];
    }
  } else if (Array.isArray(bodyIn?.messages)) {
    prior = bodyIn.messages
      .filter((m) => m && m.role !== 'system')
      .map((m) => normalizeStoredMessage(m))
      .filter(Boolean);
  }

  const result = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...prior]
    : prior;
  debugLogMessages('buildConversationMessagesAsync(persistence)', result, persistence);
  return result;
}

/**
 * Like `buildConversationMessagesAsync`, plus the stored Responses API id this
 * turn can continue from (`previous_response_id`), when doing so is safe.
 *
 * Safe means the server-side response holds exactly the history being sent
 * minus the new user message(s): the newest stored assistant message on the
 * active branch carries a `resp_` id, any tool rows after it answer that
 * message's own calls, and only user messages follow. Anything else (no id on
 * the newest reply, an error or cancelled reply, edits) returns `resumeFrom: null`
 * and the turn sends full history.
 */
export async function buildConversationMessagesWithResumeAsync({ body, bodyIn, persistence, userId }) {
  const messages = await buildConversationMessagesAsync({ body, bodyIn, persistence, userId });
  const hasPersistence = !!(persistence && persistence.persist && persistence.conversationId);
  if (!hasPersistence) return { messages, resumeFrom: null };
  try {
    const page = getMessagesPage({ conversationId: persistence.conversationId, afterSeq: 0, limit: 200 });
    return { messages, resumeFrom: resumableResponseId(page?.messages || []) };
  } catch {
    return { messages, resumeFrom: null };
  }
}

/** The response id the next turn may continue from, or null. See buildConversationMessagesWithResumeAsync. */
export function resumableResponseId(storedMessages) {
  // The same messages the turn sends, in order.
  const sent = storedMessages.filter((m) => normalizeStoredMessage(m));
  let i = sent.length - 1;
  let newUserMessages = 0;
  while (i >= 0 && sent[i].role === 'user') {
    newUserMessages++;
    i--;
  }
  if (newUserMessages === 0) return null;

  const toolCallIds = new Set();
  while (i >= 0 && sent[i].role === 'tool') {
    for (const output of sent[i].tool_outputs ?? []) toolCallIds.add(output.tool_call_id);
    if (sent[i].tool_call_id) toolCallIds.add(sent[i].tool_call_id);
    i--;
  }
  const assistant = sent[i];
  if (!assistant || assistant.role !== 'assistant' || assistant.status !== 'final') return null;
  if (!isValidResponsesAPIId(assistant.response_id)) return null;
  // Tool rows must belong to this reply's calls, already settled in its response.
  const ownCalls = new Set((assistant.tool_calls ?? []).map((tc) => tc.id));
  for (const id of toolCallIds) if (!ownCalls.has(id)) return null;
  return assistant.response_id;
}

/**
 * Validate if a response_id is compatible with the Responses API
 * The Responses API expects IDs that begin with 'resp_'
 * @param {string} responseId - The response ID to validate
 * @returns {boolean} True if valid for Responses API
 */
function isValidResponsesAPIId(responseId) {
  return typeof responseId === 'string' && responseId.startsWith('resp_');
}

/**
 * Build conversation messages optimized for Responses API using previous_response_id
 * Falls back to full history if no response_id is available
 * @param {Object} params - Parameters object
 * @param {Object} params.body - Request body
 * @param {Object} params.bodyIn - Input body
 * @param {Object} params.persistence - Persistence instance
 * @param {string} params.userId - User ID for resolving custom prompts
 * @param {Object} params.provider - Provider instance (optional, to check if Responses API is supported)
 * @returns {Promise<{messages: Array, previousResponseId: string|null}>} Messages and response ID
 */
export async function buildConversationMessagesOptimized({ body, bodyIn, persistence, userId, provider = null }) {
  const sanitizedMessages = Array.isArray(body?.messages) ? [...body.messages] : [];
  const nonSystemMessages = sanitizedMessages.filter((msg) => msg && msg.role !== 'system');
  const systemPrompt = await extractSystemPromptAsync({ body, bodyIn, persistence, userId });
  const hasPersistence = !!(persistence && persistence.persist && persistence.conversationId);

  // If messages provided in request, use them (new conversation or explicit history)
  if (nonSystemMessages.length > 0 && !hasPersistence) {
    const messages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...nonSystemMessages]
      : nonSystemMessages;
    debugLogMessages('buildConversationMessagesOptimized(request)', messages, persistence);
    return {
      messages,
      previousResponseId: null
    };
  }

  // Try to use response_id for existing conversations (Responses API optimization)
  // Only use this optimization if provider supports Responses API
  const supportsResponsesAPI = provider?.shouldUseResponsesAPI?.() ?? false;

  if (persistence && persistence.persist && persistence.conversationId && supportsResponsesAPI) {
    try {
      // Continue only from the newest stored reply, and only when nothing but new
      // user messages follow it (see resumableResponseId).
      const storedPage = getMessagesPage({ conversationId: persistence.conversationId, afterSeq: 0, limit: 200 });
      const storedMessages = storedPage?.messages || [];
      const previousResponseId = resumableResponseId(storedMessages);

      if (previousResponseId) {
        // Send every user message after that reply (more than one after a failed turn).
        const sent = storedMessages.map((m) => normalizeStoredMessage(m)).filter(Boolean);
        let start = sent.length;
        while (start > 0 && sent[start - 1].role === 'user') start--;
        const newUserMessages = sent.slice(start);

        const messages = systemPrompt
          ? [{ role: 'system', content: systemPrompt }, ...newUserMessages]
          : newUserMessages;

        debugLogMessages('buildConversationMessagesOptimized(previousResponseId)', messages, persistence);
        return { messages, previousResponseId };
      }

      // No response_id yet - fall back to full history for this conversation
      const page = getMessagesPage({ conversationId: persistence.conversationId, afterSeq: 0, limit: 200 });
      const prior = [];

      logger.debug('[toolOrchestrationUtils] Retrieved ' + page?.messages?.length + ' messages for conversation ' + persistence.conversationId);

      for (const m of page?.messages || []) {
        const normalized = normalizeStoredMessage(m);
        if (normalized) prior.push(normalized);
      }

      logger.debug('[toolOrchestrationUtils] After normalization: ' + prior.length + ' messages left');

      const messagesWithSystem = systemPrompt
        ? [{ role: 'system', content: systemPrompt }, ...prior]
        : prior;
      debugLogMessages('buildConversationMessagesOptimized(persistence)', messagesWithSystem, persistence);
      return {
        messages: messagesWithSystem,
        previousResponseId: null
      };
    } catch (error) {
      logger.warn('[toolOrchestrationUtils] Failed to get response_id, falling back to full history:', error);
      // Fall through to bodyIn messages
    }
  }

  // Persistence available but provider doesn't support Responses API: load full history
  if (persistence && persistence.persist && persistence.conversationId) {
    try {
      const page = getMessagesPage({ conversationId: persistence.conversationId, afterSeq: 0, limit: 200 });
      const prior = [];

      logger.debug('[toolOrchestrationUtils] Retrieved ' + page?.messages?.length + ' messages for conversation ' + persistence.conversationId);

      for (const m of page?.messages || []) {
        const normalized = normalizeStoredMessage(m);
        if (normalized) prior.push(normalized);
      }

      logger.debug('[toolOrchestrationUtils] After normalization: ' + prior.length + ' messages left');

      const messages = systemPrompt
        ? [{ role: 'system', content: systemPrompt }, ...prior]
        : prior;
      debugLogMessages('buildConversationMessagesOptimized(persistence_fallback)', messages, persistence);
      return {
        messages,
        previousResponseId: null
      };
    } catch (error) {
      logger.warn('[toolOrchestrationUtils] Failed to load persistence fallback history:', error);
    }
  }

  // Final fallback: rely on bodyIn history (may lack tool metadata)
  const prior = Array.isArray(bodyIn?.messages)
    ? bodyIn.messages
      .filter((m) => m && m.role !== 'system')
      .map((m) => normalizeStoredMessage(m))
      .filter(Boolean)
    : [];

  const messages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...prior]
    : prior;
  debugLogMessages('buildConversationMessagesOptimized(bodyIn)', messages, persistence);
  return {
    messages,
    previousResponseId: null
  };
}

export function appendToPersistence(persistence, content) {
  if (!persistence || !persistence.persist) return;
  if (typeof content !== 'string' || content.length === 0) return;
  persistence.appendContent(content);
}

export function recordFinalToPersistence(persistence, finishReason, responseId = null) {
  if (!persistence || !persistence.persist) return;
  persistence.recordAssistantFinal({ finishReason: finishReason || 'stop', responseId });
}

export function emitConversationMetadata(res, persistence) {
  const conversationMeta = getConversationMetadata(persistence);
  if (!conversationMeta) return;
  res.write(`data: ${JSON.stringify(conversationMeta)}\n\n`);
  if (typeof res.flush === 'function') res.flush();
}

export function streamDeltaEvent({ res, model, event, prefix = 'tool' }) {
  const chunk = {
    id: `${prefix}_${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: event,
      finish_reason: null,
    }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  if (typeof res.flush === 'function') res.flush();
}

export function streamDone(res) {
  res.write('data: [DONE]\n\n');
  if (typeof res.flush === 'function') res.flush();
}
