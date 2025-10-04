import { tools as toolRegistry } from './tools.js';
import { getMessagesPage, getLastAssistantResponseId } from '../db/messages.js';
import { getConversationMetadata } from './responseUtils.js';

/**
 * Resolve system prompt content from active system prompt ID
 * @param {string} activePromptId - The active system prompt ID
 * @param {string} userId - User ID for custom prompts
 * @returns {Promise<string>} Resolved system prompt content
 */
async function resolveSystemPromptContent(activePromptId, userId) {
  if (!activePromptId) return '';

  try {
    const { getPromptById } = await import('./promptService.js');
    const prompt = await getPromptById(activePromptId, userId);
    return prompt?.body || '';
  } catch (error) {
    console.warn('[toolOrchestrationUtils] Failed to resolve system prompt:', error);
    return '';
  }
}

export function extractSystemPrompt({ body, bodyIn, persistence }) {
  const fromMessages = Array.isArray(body?.messages)
    ? body.messages.find((msg) => msg && msg.role === 'system' && typeof msg.content === 'string' && msg.content.trim())
    : null;
  if (fromMessages) {
    return fromMessages.content.trim();
  }

  const fromBodyParam = typeof bodyIn?.systemPrompt === 'string'
    ? bodyIn.systemPrompt.trim()
    : (typeof bodyIn?.system_prompt === 'string' ? bodyIn.system_prompt.trim() : '');
  if (fromBodyParam) {
    return fromBodyParam;
  }

  const fromPersistence = persistence?.conversationMeta?.metadata?.system_prompt;
  if (typeof fromPersistence === 'string' && fromPersistence.trim()) {
    return fromPersistence.trim();
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
  // First try the synchronous extraction (inline overrides, legacy system_prompt)
  const syncPrompt = extractSystemPrompt({ body, bodyIn, persistence });
  if (syncPrompt) {
    return syncPrompt;
  }

  // If no inline override, check if there's an active system prompt ID to resolve
  const activePromptId = persistence?.conversationMeta?.metadata?.active_system_prompt_id;
  if (activePromptId) {
    const resolvedContent = await resolveSystemPromptContent(activePromptId, userId);
    if (resolvedContent) {
      return resolvedContent;
    }
  }

  return '';
}

export function buildConversationMessages({ body, bodyIn, persistence }) {
  const sanitizedMessages = Array.isArray(body?.messages) ? [...body.messages] : [];
  const nonSystemMessages = sanitizedMessages.filter((msg) => msg && msg.role !== 'system');
  const systemPrompt = extractSystemPrompt({ body, bodyIn, persistence });

  if (nonSystemMessages.length > 0) {
    return systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...nonSystemMessages]
      : nonSystemMessages;
  }

  let prior = [];
  if (persistence && persistence.persist && persistence.conversationId) {
    try {
      const page = getMessagesPage({ conversationId: persistence.conversationId, afterSeq: 0, limit: 200 });
      prior = (page?.messages || [])
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && (typeof m.content === 'string' || Array.isArray(m.content)))
        .map((m) => ({ role: m.role, content: m.content }));
    } catch {
      prior = Array.isArray(bodyIn?.messages)
        ? bodyIn.messages.filter((m) => m && m.role !== 'system')
        : [];
    }
  } else if (Array.isArray(bodyIn?.messages)) {
    prior = bodyIn.messages.filter((m) => m && m.role !== 'system');
  }

  if (systemPrompt) {
    return [{ role: 'system', content: systemPrompt }, ...prior];
  }

  return prior;
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

  if (nonSystemMessages.length > 0) {
    return systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...nonSystemMessages]
      : nonSystemMessages;
  }

  let prior = [];
  if (persistence && persistence.persist && persistence.conversationId) {
    try {
      const page = getMessagesPage({ conversationId: persistence.conversationId, afterSeq: 0, limit: 200 });
      prior = (page?.messages || [])
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && (typeof m.content === 'string' || Array.isArray(m.content)))
        .map((m) => ({ role: m.role, content: m.content }));
    } catch {
      prior = Array.isArray(bodyIn?.messages)
        ? bodyIn.messages.filter((m) => m && m.role !== 'system')
        : [];
    }
  } else if (Array.isArray(bodyIn?.messages)) {
    prior = bodyIn.messages.filter((m) => m && m.role !== 'system');
  }

  if (systemPrompt) {
    return [{ role: 'system', content: systemPrompt }, ...prior];
  }

  return prior;
}

/**
 * Build conversation messages optimized for Responses API using previous_response_id
 * Falls back to full history if no response_id is available
 * @param {Object} params - Parameters object
 * @param {Object} params.body - Request body
 * @param {Object} params.bodyIn - Input body
 * @param {Object} params.persistence - Persistence instance
 * @param {string} params.userId - User ID for resolving custom prompts
 * @returns {Promise<{messages: Array, previousResponseId: string|null}>} Messages and response ID
 */
export async function buildConversationMessagesOptimized({ body, bodyIn, persistence, userId }) {
  const sanitizedMessages = Array.isArray(body?.messages) ? [...body.messages] : [];
  const nonSystemMessages = sanitizedMessages.filter((msg) => msg && msg.role !== 'system');
  const systemPrompt = await extractSystemPromptAsync({ body, bodyIn, persistence, userId });

  // If messages provided in request, use them (new conversation or explicit history)
  if (nonSystemMessages.length > 0) {
    return {
      messages: systemPrompt
        ? [{ role: 'system', content: systemPrompt }, ...nonSystemMessages]
        : nonSystemMessages,
      previousResponseId: null
    };
  }

  // Try to use response_id for existing conversations (Responses API optimization)
  if (persistence && persistence.persist && persistence.conversationId) {
    try {
      const previousResponseId = getLastAssistantResponseId({ conversationId: persistence.conversationId });

      if (previousResponseId) {
        // We have a response_id - only send the current user message
        // OpenAI will manage conversation state server-side
        const userMessages = Array.isArray(bodyIn?.messages)
          ? bodyIn.messages.filter((m) => m && m.role === 'user')
          : [];

        const messages = systemPrompt
          ? [{ role: 'system', content: systemPrompt }, ...userMessages]
          : userMessages;

        return { messages, previousResponseId };
      }

      // No response_id yet - fall back to full history for this conversation
      const page = getMessagesPage({ conversationId: persistence.conversationId, afterSeq: 0, limit: 200 });
      const prior = (page?.messages || [])
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role, content: m.content }));

      return {
        messages: systemPrompt
          ? [{ role: 'system', content: systemPrompt }, ...prior]
          : prior,
        previousResponseId: null
      };
    } catch (error) {
      console.warn('[toolOrchestrationUtils] Failed to get response_id, falling back to full history:', error);
      // Fall through to bodyIn messages
    }
  }

  // No persistence or error - use bodyIn messages
  const prior = Array.isArray(bodyIn?.messages)
    ? bodyIn.messages.filter((m) => m && m.role !== 'system')
    : [];

  return {
    messages: systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...prior]
      : prior,
    previousResponseId: null
  };
}

export async function executeToolCall(call) {
  const name = call?.function?.name;
  const argsStr = call?.function?.arguments || '{}';
  const tool = toolRegistry[name];

  if (!tool) {
    throw new Error(`unknown_tool: ${name}`);
  }

  let args;
  try {
    args = JSON.parse(argsStr || '{}');
  } catch {
    throw new Error('invalid_arguments_json');
  }

  const validated = tool.validate ? tool.validate(args) : args;
  const output = await tool.handler(validated);
  return { name, output };
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
