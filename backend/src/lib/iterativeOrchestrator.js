import fetch from 'node-fetch';
import { tools as toolRegistry, generateOpenAIToolSpecs } from './tools.js';
import { getMessagesPage } from '../db/index.js';
import { parseSSEStream } from './sseParser.js';
import { createOpenAIRequest, writeAndFlush, createChatCompletionChunk } from './streamUtils.js';
import { getConversationMetadata } from './responseUtils.js';

/**
 * Iterative tool orchestration with thinking and dynamic tool execution
 * Supports AI reasoning between tool calls within a single conversation turn
 */

const MAX_ITERATIONS = 10; // Prevent infinite loops
const THINKING_PROMPT = `You are in iterative mode. You can think step-by-step and use tools multiple times in a conversation.

IMPORTANT RULES:
1. When you need tools, make the tool calls (this will be non-streaming)
2. When you want to think or provide explanations, respond with text content
3. You can alternate between tool calling and thinking as many times as needed
4. When you have all the information needed, provide your final comprehensive answer

The user's request may require multiple steps. Take your time to gather all necessary information before providing the final answer.`;

/**
 * Execute a single tool call
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
 * Stream an event to the client
 */
function streamEvent(res, event, model) {
  const chunk = {
    id: `iter_${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [{
      index: 0,
      delta: event,
      finish_reason: null,
    }],
  };
  res.write(`data: ${JSON.stringify(chunk)}

`);
  if (typeof res.flush === 'function') res.flush();
}

/**
 * Make a request to the AI model
 */
async function callModel(messages, config, bodyParams, tools = null) {
  const url = `${config.openaiBaseUrl}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.openaiApiKey}`,
  };

  const requestBody = {
    model: bodyParams.model || config.defaultModel,
    messages,
    stream: false,
    ...(tools && { tools, tool_choice: 'auto' })
  };
  // Include reasoning controls only for gpt-5* models
  const isGpt5 = typeof requestBody.model === 'string' && requestBody.model.startsWith('gpt-5');
  if (isGpt5) {
    if (bodyParams.reasoning_effort) requestBody.reasoning_effort = bodyParams.reasoning_effort;
    if (bodyParams.verbosity) requestBody.verbosity = bodyParams.verbosity;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });

  const result = await response.json();
  return result?.choices?.[0]?.message;
}

/**
 * Handle iterative tool orchestration with thinking support
 */
export async function handleIterativeOrchestration({
  body,
  bodyIn,
  config,
  res,
  req,
  persistence,
}) {
  try {
    // Build conversation history
    let prior = [];
    if (persistence && persistence.persist && persistence.conversationId) {
      try {
        // Load last N persisted messages to preserve context during tool runs
        const page = getMessagesPage({ conversationId: persistence.conversationId, afterSeq: 0, limit: 200 });
        prior = (page?.messages || [])
          .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .map(m => ({ role: m.role, content: m.content }));
      } catch (e) {
        // Fallback to request body messages if DB fetch fails
        prior = [...(bodyIn.messages || [])];
      }
    } else {
      // No persistence, rely on request body
      prior = [...(bodyIn.messages || [])];
    }

    // Initialize conversation with thinking prompt + prior context
    const conversationHistory = [
      { role: 'system', content: THINKING_PROMPT },
      ...prior,
    ];

    let iteration = 0;
    let isComplete = false;

    while (!isComplete && iteration < MAX_ITERATIONS) {
      iteration++;

      // Stream the model response for this iteration, buffering only tool calls
      const requestBody = {
        model: body.model || config.defaultModel,
        messages: conversationHistory,
        stream: true,
        tools: generateOpenAIToolSpecs(),
        tool_choice: 'auto',
      };
      // Include reasoning controls only for gpt-5* models
      if (typeof requestBody.model === 'string' && requestBody.model.startsWith('gpt-5')) {
        if (body.reasoning_effort) requestBody.reasoning_effort = body.reasoning_effort;
        if (body.verbosity) requestBody.verbosity = body.verbosity;
      }

      const upstream = await createOpenAIRequest(config, requestBody);

      let leftoverIter = '';
      const toolCallMap = new Map(); // index -> accumulated tool call
      let gotAnyNonToolDelta = false;

      await new Promise((resolve, reject) => {
        upstream.body.on('data', (chunk) => {
          try {
            leftoverIter = parseSSEStream(
              chunk,
              leftoverIter,
              (obj) => {
                const choice = obj?.choices?.[0];
                const delta = choice?.delta || {};

                // Accumulate tool_calls, but do not stream their partial deltas
                if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
                  for (const tcDelta of delta.tool_calls) {
                    const idx = tcDelta.index ?? 0;
                    const existing = toolCallMap.get(idx) || {
                      id: tcDelta.id,
                      type: 'function',
                      function: { name: '', arguments: '' },
                    };
                    if (tcDelta.id && !existing.id) existing.id = tcDelta.id;
                    if (tcDelta.function?.name) existing.function.name = tcDelta.function.name;
                    if (tcDelta.function?.arguments) existing.function.arguments += tcDelta.function.arguments;
                    toolCallMap.set(idx, existing);
                  }
                } else {
                  // Stream any non-tool delta chunk directly to the client
                  writeAndFlush(res, `data: ${JSON.stringify(obj)}

`);
                  gotAnyNonToolDelta = true;
                }

                // Persist text content only
                if (persistence && persistence.persist && typeof delta.content === 'string' && delta.content.length > 0) {
                  persistence.appendContent(delta.content);
                }
              },
              () => resolve(),
              () => { /* ignore JSON parse errors for this stream */ }
            );
          } catch (e) {
            reject(e);
          }
        });
        upstream.body.on('error', reject);
      });

      const toolCalls = Array.from(toolCallMap.values());

      if (toolCalls.length > 0) {
        // Emit a single consolidated tool_calls chunk (buffered deltas)
        const toolCallChunk = createChatCompletionChunk(
          bodyIn.id || 'chatcmpl-' + Date.now(),
          body.model || config.defaultModel,
          { tool_calls: toolCalls }
        );
        writeAndFlush(res, `data: ${JSON.stringify(toolCallChunk)}

`);

        // Add assistant message with tool calls for the next iteration
        conversationHistory.push({ role: 'assistant', tool_calls: toolCalls });

        // Execute each tool call and stream tool_output events
        for (const toolCall of toolCalls) {
          try {
            const { name, output } = await executeToolCall(toolCall);
            streamEvent(res, {
              tool_output: {
                tool_call_id: toolCall.id,
                name,
                output,
              },
            }, body.model || config.defaultModel);

            conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: typeof output === 'string' ? output : JSON.stringify(output),
            });
          } catch (error) {
            const errorMessage = `Tool ${toolCall.function?.name} failed: ${error.message}`;
            streamEvent(res, {
              tool_output: {
                tool_call_id: toolCall.id,
                name: toolCall.function?.name,
                output: errorMessage,
              },
            }, body.model || config.defaultModel);
            conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: errorMessage,
            });
          }
        }
        // Continue to next iteration; the model will use the tool results
      } else {
        // No tools requested in this iteration; if any content was streamed, consider complete
        if (gotAnyNonToolDelta) {
          isComplete = true;
        } else {
          // Safety: nothing streamed and no tool calls (unlikely), avoid infinite loop
          isComplete = true;
        }
      }

      // Safety check to prevent infinite loops
      if (iteration >= MAX_ITERATIONS) {
        const maxIterMsg = '\n\n[Maximum iterations reached]';
        streamEvent(res, { content: maxIterMsg }, body.model || config.defaultModel);
        if (persistence && persistence.persist) {
          persistence.appendContent(maxIterMsg);
        }
        isComplete = true;
      }
    }

    // Send final completion chunk
    const finalChunk = {
      id: `iter_final_${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: config.model || config.defaultModel,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'stop',
      }],
    };
    res.write(`data: ${JSON.stringify(finalChunk)}

`);

    // Include conversation metadata before [DONE] if auto-created
    const conversationMeta = getConversationMetadata(persistence);
    if (conversationMeta) {
      res.write(`data: ${JSON.stringify(conversationMeta)}\n\n`);
    }

    res.write('data: [DONE]\n\n');

    // Finalize persistence
    if (persistence && persistence.persist) {
      persistence.recordAssistantFinal({ finishReason: 'stop' });
    }

    res.end();

  } catch (error) {
    console.error('[iterative orchestration] error:', error);

    // Stream error to client
    const errorMsg = `[Error: ${error.message}]`;
    streamEvent(res, { content: errorMsg }, body?.model || config.defaultModel);

    if (persistence && persistence.persist) {
      persistence.appendContent(errorMsg);
      persistence.markError();
    }

    // Include conversation metadata before [DONE] if auto-created
    const conversationMeta = getConversationMetadata(persistence);
    if (conversationMeta) {
      res.write(`data: ${JSON.stringify(conversationMeta)}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  }
}
