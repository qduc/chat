import { tools as toolRegistry } from './tools.js';
import { getMessagesPage, getLastAssistantResponseId } from '../db/messages.js';
import { getConversationMetadata } from './responseUtils.js';

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
    console.log(`[toolOrchestrationUtils] ${label}`, {
      conversationId,
      messageCount: Array.isArray(messages) ? messages.length : null,
      messages: condensed,
    });
  } catch (error) {
    console.warn('[toolOrchestrationUtils] Failed to log messages', error);
  }
}

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
        if (!m || !(m.role === 'user' || m.role === 'assistant')) continue;
        if (!(typeof m.content === 'string' || Array.isArray(m.content))) continue;

        // Build the message object
        const msg = { role: m.role, content: m.content };

        // Include tool_calls if present on assistant messages
        if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
          msg.tool_calls = m.tool_calls.map(tc => ({
            id: tc.id,
            type: tc.type || 'function',
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments || '{}' // Ensure valid JSON
            }
          }));
        }

        messages.push(msg);

        // Add tool response messages after assistant messages with tool calls
        if (m.role === 'assistant' && Array.isArray(m.tool_outputs) && m.tool_outputs.length > 0) {
          for (const output of m.tool_outputs) {
            messages.push({
              role: 'tool',
              tool_call_id: output.tool_call_id,
              content: output.output
            });
          }
        }
      }

      prior = messages;
    } catch {
      prior = Array.isArray(bodyIn?.messages)
        ? bodyIn.messages.filter((m) => m && m.role !== 'system')
        : [];
    }
  } else if (Array.isArray(bodyIn?.messages)) {
    prior = bodyIn.messages.filter((m) => m && m.role !== 'system');
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
        if (!m || !(m.role === 'user' || m.role === 'assistant')) continue;
        if (!(typeof m.content === 'string' || Array.isArray(m.content))) continue;

        // Build the message object
        const msg = { role: m.role, content: m.content };

        // Include tool_calls if present on assistant messages
        if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
          msg.tool_calls = m.tool_calls.map(tc => ({
            id: tc.id,
            type: tc.type || 'function',
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments || '{}' // Ensure valid JSON
            }
          }));
        }

        messages.push(msg);

        // Add tool response messages after assistant messages with tool calls
        if (m.role === 'assistant' && Array.isArray(m.tool_outputs) && m.tool_outputs.length > 0) {
          for (const output of m.tool_outputs) {
            messages.push({
              role: 'tool',
              tool_call_id: output.tool_call_id,
              content: output.output
            });
          }
        }
      }

      prior = messages;
    } catch {
      prior = Array.isArray(bodyIn?.messages)
        ? bodyIn.messages.filter((m) => m && m.role !== 'system')
        : [];
    }
  } else if (Array.isArray(bodyIn?.messages)) {
    prior = bodyIn.messages.filter((m) => m && m.role !== 'system');
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
 * @returns {Promise<{messages: Array, previousResponseId: string|null}>} Messages and response ID
 */
export async function buildConversationMessagesOptimized({ body, bodyIn, persistence, userId }) {
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

        debugLogMessages('buildConversationMessagesOptimized(previousResponseId)', messages, persistence);
        return { messages, previousResponseId };
      }

      // No response_id yet - fall back to full history for this conversation
      const page = getMessagesPage({ conversationId: persistence.conversationId, afterSeq: 0, limit: 200 });
      const messages = [];

      for (const m of page?.messages || []) {
        if (!m || !(m.role === 'user' || m.role === 'assistant')) continue;
        if (typeof m.content !== 'string') continue;

        // Build the message object
        const msg = { role: m.role, content: m.content };

        // Include tool_calls if present on assistant messages
        if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
          msg.tool_calls = m.tool_calls.map(tc => ({
            id: tc.id,
            type: tc.type || 'function',
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments || '{}' // Ensure valid JSON
            }
          }));
        }

        messages.push(msg);

        // Add tool response messages after assistant messages with tool calls
        if (m.role === 'assistant' && Array.isArray(m.tool_outputs) && m.tool_outputs.length > 0) {
          for (const output of m.tool_outputs) {
            messages.push({
              role: 'tool',
              tool_call_id: output.tool_call_id,
              content: output.output
            });
          }
        }
      }

      const prior = messages;

      const messagesWithSystem = systemPrompt
        ? [{ role: 'system', content: systemPrompt }, ...prior]
        : prior;
      debugLogMessages('buildConversationMessagesOptimized(persistence)', messagesWithSystem, persistence);
      return {
        messages: messagesWithSystem,
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
