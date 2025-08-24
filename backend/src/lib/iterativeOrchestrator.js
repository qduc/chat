import fetch from 'node-fetch';
import { tools as toolRegistry } from './tools.js';

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
function streamEvent(res, event) {
  const chunk = {
    id: `iter_${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'gpt-3.5-turbo',
    choices: [{
      index: 0,
      delta: event,
      finish_reason: null,
    }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
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
    model: bodyParams.model || config.defaultModel || 'gpt-3.5-turbo',
    messages,
    stream: false,
    ...(tools && { tools, tool_choice: 'auto' })
  };
  
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
  persist,
  assistantMessageId,
  appendAssistantContent,
  finalizeAssistantMessage,
  markAssistantError,
  buffer,
  flushedOnce,
  sizeThreshold,
}) {
  const doFlush = () => {
    if (!persist || !assistantMessageId) return;
    if (buffer.value.length === 0) return;
    
    appendAssistantContent({
      messageId: assistantMessageId,
      delta: buffer.value,
    });
    buffer.value = '';
    flushedOnce.value = true;
  };

  try {
    // Initialize conversation with thinking prompt
    const conversationHistory = [
      { role: 'system', content: THINKING_PROMPT },
      ...(bodyIn.messages || [])
    ];
    
    let iteration = 0;
    let isComplete = false;

    while (!isComplete && iteration < MAX_ITERATIONS) {
      iteration++;
      
      // Get next response from AI (with or without tools)
      const aiResponse = await callModel(
        conversationHistory, 
        config,
        body,
        body.tools // Pass tools so AI can decide when to use them
      );
      
      if (!aiResponse) {
        throw new Error('No response from AI model');
      }

      // Handle tool calls if present
      if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
        // Stream thinking content if present
        if (aiResponse.content) {
          streamEvent(res, { content: aiResponse.content });
          if (persist) {
            buffer.value += aiResponse.content;
            if (buffer.value.length >= sizeThreshold) doFlush();
          }
        }
        
        // Stream each tool call (properly formatted, not fragmented)
        for (const toolCall of aiResponse.tool_calls) {
          streamEvent(res, { tool_calls: [toolCall] });
        }
        
        // Add AI message with tool calls to conversation
        conversationHistory.push(aiResponse);
        
        // Execute each tool call
        for (const toolCall of aiResponse.tool_calls) {
          try {
            const { name, output } = await executeToolCall(toolCall);
            
            // Stream tool output event
            streamEvent(res, { 
              tool_output: {
                tool_call_id: toolCall.id,
                name,
                output
              }
            });
            
            // Add tool result to conversation
            conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: typeof output === 'string' ? output : JSON.stringify(output),
            });
            
          } catch (error) {
            // Handle tool execution error
            const errorMessage = `Tool ${toolCall.function?.name} failed: ${error.message}`;
            streamEvent(res, {
              tool_output: {
                tool_call_id: toolCall.id,
                name: toolCall.function?.name,
                output: errorMessage
              }
            });
            
            conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: errorMessage,
            });
          }
        }
        
        // Continue iteration - don't stop after tool calls
        // The AI will decide in the next iteration what to do with the tool results
        
      } else if (aiResponse.content) {
        // No tool calls, this is thinking or final response
        streamEvent(res, { content: aiResponse.content });
        
        if (persist) {
          buffer.value += aiResponse.content;
          if (buffer.value.length >= sizeThreshold) doFlush();
        }
        
        conversationHistory.push(aiResponse);
        
        // If we got content and no tool calls, this is likely the final response
        isComplete = true;
      }
      
      // Safety check to prevent infinite loops
      if (iteration >= MAX_ITERATIONS) {
        const maxIterMsg = '\n\n[Maximum iterations reached]';
        streamEvent(res, { content: maxIterMsg });
        if (persist) buffer.value += maxIterMsg;
        isComplete = true;
      }
    }

    // Send final completion chunk
    const finalChunk = {
      id: `iter_final_${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: config.model || 'gpt-3.5-turbo',
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'stop',
      }],
    };
    res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
    res.write('data: [DONE]\n\n');

    // Finalize persistence
    if (persist && assistantMessageId) {
      doFlush();
      finalizeAssistantMessage({
        messageId: assistantMessageId,
        finishReason: 'stop',
        status: 'final',
      });
    }

    res.end();
    
  } catch (error) {
    console.error('[iterative orchestration] error:', error);
    
    // Stream error to client
    const errorMsg = `[Error: ${error.message}]`;
    streamEvent(res, { content: errorMsg });
    
    if (persist && assistantMessageId) {
      buffer.value += errorMsg;
      doFlush();
      markAssistantError({ messageId: assistantMessageId });
    }
    
    res.write('data: [DONE]\n\n');
    res.end();
  }
}