import fetch from 'node-fetch';
import { tools as toolRegistry, generateOpenAIToolSpecs } from './tools.js';

/**
 * Execute a single tool call from the local registry
 * @param {Object} call - Tool call object with function name and arguments
 * @returns {Promise<{name: string, output: any}>} Tool execution result
 */
async function executeToolCall(call) {
  const name = call?.function?.name;
  const argsStr = call?.function?.arguments || '{}';
  const tool = toolRegistry[name];
  
  if (!tool) {
    throw new Error(`unknown_tool: ${name}`);
  }
  
  let args;
  try {
    args = JSON.parse(argsStr || '{}');
  } catch (e) {
    throw new Error('invalid_arguments_json');
  }
  
  const validated = tool.validate ? tool.validate(args) : args;
  const output = await tool.handler(validated);
  return { name, output };
}

/**
 * Handle tool orchestration for non-streaming requests
 * Executes a 2-turn flow: first turn gets tool calls, second turn gets final response
 * @param {Object} params - Orchestration parameters
 * @param {Object} params.body - Request body
 * @param {Object} params.bodyIn - Original request body with all fields
 * @param {Object} params.config - Configuration object
 * @param {Object} params.res - Express response object
 * @param {boolean} params.persist - Whether persistence is enabled
 * @param {string|null} params.assistantMessageId - Assistant message ID for persistence
 * @returns {Promise<void>} Sends response and returns
 */
export async function handleToolOrchestration({
  body,
  bodyIn,
  config,
  res,
  persist,
  assistantMessageId,
  appendAssistantContent,
  finalizeAssistantMessage,
}) {
  const url = `${config.openaiBaseUrl}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.openaiApiKey}`,
  };

  // First turn: get tool calls (non-streaming)
  const body1 = { 
    ...body, 
    stream: false,
    tools: generateOpenAIToolSpecs(), // Use backend registry as source of truth
  };
  const r1 = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body1),
  });
  const j1 = await r1.json();

  const msg1 = j1?.choices?.[0]?.message;
  const toolCalls = msg1?.tool_calls || [];
  
  if (!toolCalls.length) {
    // No tool calls; behave like regular non-streaming path
    return res.status(r1.status).json(j1);
  }

  // Execute tools and build follow-up messages
  const toolResults = [];
  for (const tc of toolCalls) {
    const { output } = await executeToolCall(tc);
    toolResults.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: typeof output === 'string' ? output : JSON.stringify(output),
    });
  }

  // Second turn: get final response with tool results
  const messagesFollowUp = [...(bodyIn.messages || []), msg1, ...toolResults];
  const body2 = {
    model: body.model,
    messages: messagesFollowUp,
    stream: false,
    tools: generateOpenAIToolSpecs(), // Use backend registry as source of truth
    tool_choice: body.tool_choice,
  };
  
  const r2 = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body2),
  });
  const j2 = await r2.json();

  // Persistence for final content
  const finalContent = j2?.choices?.[0]?.message?.content;
  const finalFinish = j2?.choices?.[0]?.finish_reason || null;
  
  if (persist && assistantMessageId && finalContent) {
    appendAssistantContent({
      messageId: assistantMessageId,
      delta: finalContent,
    });
    finalizeAssistantMessage({
      messageId: assistantMessageId,
      finishReason: finalFinish,
    });
  }
  
  return res.status(r2.status).json(j2);
}