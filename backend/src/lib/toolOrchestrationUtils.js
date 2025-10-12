import { tools as toolRegistry } from './tools.js';
import { getMessagesPage, getLastAssistantResponseId } from '../db/messages.js';
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

  const webSearchToolNames = ['web_search', 'web_search_exa', 'web_search_searxng'];

  return enabledTools.some(tool => {
    // Handle both tool spec objects and simple tool names
    const toolName = typeof tool === 'string' ? tool : tool?.function?.name || tool?.name;
    return webSearchToolNames.includes(toolName);
  });
}

/**
 * Load shared modules for all prompts
 * @param {Array} enabledTools - Array of enabled tools (optional)
 * @returns {Promise<string>} Shared modules content
 */
async function loadSharedModules(enabledTools = null) {
  try {
    const { readdir, readFile } = await import('fs/promises');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const modulesDir = join(__dirname, '..', 'prompts', 'builtins', '_modules');

    try {
      const files = await readdir(modulesDir);
      const moduleFiles = files.filter(file => file.endsWith('.md'));

      if (moduleFiles.length === 0) {
        return '';
      }

      const hasWebSearch = hasWebSearchToolsEnabled(enabledTools);
      const moduleContents = [];

      for (const file of moduleFiles) {
        try {
          // Skip web_search module if no web search tools are enabled
          if (file === 'web_search.md' && !hasWebSearch) {
            logger.debug('[toolOrchestrationUtils] Skipping web_search module (no web search tools enabled)');
            continue;
          }

          const filePath = join(modulesDir, file);
          const content = await readFile(filePath, 'utf-8');
          moduleContents.push(content.trim());
        } catch (error) {
          logger.warn(`[toolOrchestrationUtils] Failed to load module ${file}: ${error.message}`);
        }
      }      return moduleContents.length > 0 ? moduleContents.join('\n\n') : '';
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
async function wrapPromptWithStructure(promptContent, enabledTools = null) {
  if (!promptContent) return promptContent;

  // Check if already has the structure
  if (promptContent.includes('<system_instructions>') && promptContent.includes('<user_instructions>')) {
    return promptContent;
  }

  const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  const sharedModules = await loadSharedModules(enabledTools);

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
async function resolveSystemPromptContent(activePromptId, userId, enabledTools = null) {
  if (!activePromptId) return '';

  try {
    const { getPromptById } = await import('./promptService.js');
    const prompt = await getPromptById(activePromptId, userId);
    const promptBody = prompt?.body || '';

    // All prompts (both built-in and custom) are wrapped at request time
    // This ensures consistent behavior and request-specific module inclusion
    return await wrapPromptWithStructure(promptBody, enabledTools);
  } catch (error) {
    logger.warn('[toolOrchestrationUtils] Failed to resolve system prompt:', error);
    return '';
  }
}

export function extractSystemPrompt({ body, bodyIn, persistence }) {
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

  const fromPersistence = persistence?.conversationMeta?.metadata?.system_prompt;
  if (typeof fromPersistence === 'string' && fromPersistence.trim()) {
    // Check if this is a built-in prompt (already has structure) or needs wrapping
    const trimmed = fromPersistence.trim();
    if (trimmed.includes('<system_instructions>') && trimmed.includes('<user_instructions>')) {
      return trimmed; // Already structured (built-in prompt)
    }
    return wrapPromptWithDate(trimmed);
  }

  return '';
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
  // Extract enabled tools from the request body
  const enabledTools = Array.isArray(body?.tools) ? body.tools : null;

  // Check for inline overrides first (highest priority)
  const fromMessages = Array.isArray(body?.messages)
    ? body.messages.find((msg) => msg && msg.role === 'system' && typeof msg.content === 'string' && msg.content.trim())
    : null;
  if (fromMessages) {
    return await wrapPromptWithStructure(fromMessages.content.trim(), enabledTools);
  }

  const fromBodyParam = typeof bodyIn?.systemPrompt === 'string'
    ? bodyIn.systemPrompt.trim()
    : (typeof bodyIn?.system_prompt === 'string' ? bodyIn.system_prompt.trim() : '');
  if (fromBodyParam) {
    return await wrapPromptWithStructure(fromBodyParam, enabledTools);
  }

  // If there's an active system prompt ID, resolve it (prefer this over legacy stored prompt)
  const activePromptId = persistence?.conversationMeta?.metadata?.active_system_prompt_id;
  if (activePromptId) {
    const resolvedContent = await resolveSystemPromptContent(activePromptId, userId, enabledTools);
    if (resolvedContent) {
      return resolvedContent;
    }
  }

  // Fall back to legacy stored system_prompt
  const fromPersistence = persistence?.conversationMeta?.metadata?.system_prompt;
  if (typeof fromPersistence === 'string' && fromPersistence.trim()) {
    const trimmed = fromPersistence.trim();
    if (trimmed.includes('<system_instructions>') && trimmed.includes('<user_instructions>')) {
      return trimmed; // Already structured
    }
    return await wrapPromptWithStructure(trimmed, enabledTools);
  }

  return '';
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
      .map((m) => normalizeStoredMessage(m) || { role: m.role, content: m.content });
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
          .map((m) => normalizeStoredMessage(m) || { role: m.role, content: m.content })
        : [];
    }
  } else if (Array.isArray(bodyIn?.messages)) {
    prior = bodyIn.messages
      .filter((m) => m && m.role !== 'system')
      .map((m) => normalizeStoredMessage(m) || { role: m.role, content: m.content });
  }

  const result = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...prior]
    : prior;
  debugLogMessages('buildConversationMessagesAsync(persistence)', result, persistence);
  return result;
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
      const previousResponseId = getLastAssistantResponseId({ conversationId: persistence.conversationId });

      if (previousResponseId) {
        // We have a response_id - only send the latest user message
        // OpenAI will manage conversation state server-side
        const allUserMessages = Array.isArray(bodyIn?.messages)
          ? bodyIn.messages.filter((m) => m && m.role === 'user')
          : [];

        // Take only the last user message (the new one being sent)
        const latestUserMessage = allUserMessages.length > 0
          ? [allUserMessages[allUserMessages.length - 1]]
          : [];

        const messages = systemPrompt
          ? [{ role: 'system', content: systemPrompt }, ...latestUserMessage]
          : latestUserMessage;

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
      .map((m) => normalizeStoredMessage(m) || { role: m.role, content: m.content })
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

export async function executeToolCall(call) {
  const name = call?.function?.name;
  const argsStr = call?.function?.arguments || '{}';
  const tool = toolRegistry[name];

  if (!tool) {
    return {
      name,
      output: `Error: Unknown tool '${name}'. Available tools: ${Object.keys(toolRegistry).join(', ')}. Please check the tool name and try again.`
    };
  }

  let args;
  try {
    args = JSON.parse(argsStr || '{}');
  } catch (parseError) {
    return {
      name,
      output: `Error: Invalid JSON in tool arguments. Please check the JSON syntax and try again. Arguments received: ${argsStr}`
    };
  }

  try {
    const validated = tool.validate ? tool.validate(args) : args;
    const output = await tool.handler(validated);
    return { name, output };
  } catch (executionError) {
    return {
      name,
      output: `Error executing tool '${name}': ${executionError.message}. Please check the arguments and try again.`
    };
  }
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
