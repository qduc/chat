import { BaseAdapter } from './baseAdapter.js';
import { normalizeUsage } from '../utils/usage.js';
import { convertContentPartImage } from '../localImageEncoder.js';
import { logger } from '../../logger.js';

/**
 * Adapter for Google Gemini API (Generative Language API)
 */
export class GeminiAdapter extends BaseAdapter {
  constructor(options = {}) {
    super(options);
  }
  applyCustomRequestParams(target, customParams) {
    if (!customParams || typeof customParams !== 'object' || Array.isArray(customParams)) return;
    const blocklist = new Set(['model', 'messages', 'contents', 'generationConfig', 'tools', 'tool_choice', 'stream']);
    for (const [key, value] of Object.entries(customParams)) {
      if (blocklist.has(key)) continue;
      target[key] = value;
    }
  }

  /**
   * Convert OpenAI-style message format to Gemini format
   */
  async translateRequest(internalRequest = {}, _context = {}) {
    const {
      model,
      messages,
      tools,
      tool_choice,
      max_tokens,
      temperature,
      top_p,
      top_k,
      stop,
      stream,
    } = internalRequest;

    if (!model) {
      throw new Error('Gemini provider requires a model');
    }

    const geminiRequest = {
      contents: [],
      generationConfig: {},
    };

    // Handle system messages (Gemini 1.5 supports system_instruction)
    const systemMessages = messages.filter((m) => m.role === 'system');
    if (systemMessages.length > 0) {
      geminiRequest.system_instruction = {
        parts: systemMessages.map((m) => ({ text: m.content })),
      };
    }

    // Convert conversation messages
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    // Gemini requires alternating user/model turns, but we'll do our best to map 1:1 first
    // and let the API or a separate normalization pass handle strict turn enforcement if needed.
    // For now, we map roles directly.

    for (const message of conversationMessages) {
      const role = message.role === 'assistant' ? 'model' : 'user';
      const parts = [];

      if (message.content && message.role !== 'tool') {
        if (typeof message.content === 'string') {
          parts.push({ text: message.content });
        } else if (Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part.type === 'text') {
              parts.push({ text: part.text });
            } else if (part.type === 'image_url') {
              const converted = await convertContentPartImage(part);
              if (converted?.image_url?.url) {
                const url = converted.image_url.url;
                if (url.startsWith('data:')) {
                  const [mimeType, base64Data] = url.split(';base64,');
                  const mime = mimeType.replace('data:', '');
                  parts.push({
                    inline_data: {
                      mime_type: mime,
                      data: base64Data,
                    },
                  });
                }
              }
            } else if (part.type === 'input_audio') {
              // Handle audio content
              const payload =
                part.input_audio && typeof part.input_audio === 'object'
                  ? part.input_audio
                  : (part.inputAudio && typeof part.inputAudio === 'object' ? part.inputAudio : null);

              const data = typeof payload?.data === 'string' ? payload.data : '';
              const format = typeof payload?.format === 'string' ? payload.format : '';

              if (data && format) {
                // Convert format to MIME type (e.g., 'wav' -> 'audio/wav')
                const mimeType = format.startsWith('audio/') ? format : `audio/${format}`;
                parts.push({
                  inline_data: {
                    mime_type: mimeType,
                    data: data,
                  },
                });
              }
            }
          }
        }
      }

      // Handle tool calls (assistant -> model)
      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          const functionCallPart = {
            functionCall: {
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments || '{}'),
            },
          };

          // Pass through thoughtSignature if preserved in tool call metadata
          // This is required for Gemini 2.0+ models to validate the tool call chain
          if (toolCall.gemini_thought_signature) {
             functionCallPart.thoughtSignature = toolCall.gemini_thought_signature;
          }

          parts.push(functionCallPart);
        }
      }

      // Handle tool results (tool -> functionResponse)
      // Note: Gemini expects functionResponse to be a separate part in a 'function' role or similar?
      // Actually Gemini uses 'function' role for tool outputs in some contexts, but strictly it's 'user' role with 'functionResponse' part.
      if (message.role === 'tool') {
        // In OpenAI, role is 'tool'. In Gemini, it's a 'user' turn containing functionResponse.
        // We need to find the corresponding function call if possible, but OpenAI just gives tool_call_id.
        // Gemini needs the function name.
        // If we don't have the name, we might be in trouble.
        // However, usually the conversation history preserves the order.
        // For now, we might need to assume the name is available or look it up.
        // BUT, the standard OpenAI message doesn't have the name in the tool result message.
        // We will try to pass it if we can, or use a placeholder if the API allows.
        // Wait, Gemini requires 'name' in functionResponse.
        // We might need to look back at previous messages to find the name matching the tool_call_id.
        // We also need to map the thought (if any) or validation might fail?
        // Actually, ensuring the *previous* model message has the signature is the key.

        const toolCallId = message.tool_call_id;
        const matchingToolCall = conversationMessages
          .flatMap(m => m.tool_calls || [])
          .find(tc => tc.id === toolCallId);

        const functionName = matchingToolCall?.function?.name || 'unknown_tool'; // Fallback

        parts.push({
          functionResponse: {
            name: functionName,
            response: {
              name: functionName,
              content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
            }
          }
        });
      }

      if (parts.length > 0) {
        // If it was a tool response, force role to 'user' (which it is already if we mapped 'tool' -> 'user' logic above, but let's be explicit)
        // Actually, for 'tool' role messages, we should treat them as 'user' role in Gemini.
        const finalRole = message.role === 'tool' ? 'user' : role;
        geminiRequest.contents.push({
          role: finalRole,
          parts,
        });
      }
    }

    // Tools configuration
    if (tools && tools.length > 0) {
      geminiRequest.tools = [{
        function_declarations: tools.map(t => {
          const fn = t.function;
          return {
            name: fn.name,
            description: fn.description,
            parameters: fn.parameters,
          };
        })
      }];

      if (tool_choice) {
        if (typeof tool_choice === 'string') {
          if (tool_choice === 'auto') {
            geminiRequest.tool_config = { function_calling_config: { mode: 'AUTO' } };
          } else if (tool_choice === 'none') {
            geminiRequest.tool_config = { function_calling_config: { mode: 'NONE' } };
          } else if (tool_choice === 'required') {
            geminiRequest.tool_config = { function_calling_config: { mode: 'ANY' } };
          }
        } else if (tool_choice.type === 'function') {
           geminiRequest.tool_config = {
             function_calling_config: {
               mode: 'ANY',
               allowed_function_names: [tool_choice.function.name]
             }
           };
        }
      }
    }

    // Generation config
    if (max_tokens) geminiRequest.generationConfig.maxOutputTokens = max_tokens;
    if (temperature !== undefined) geminiRequest.generationConfig.temperature = temperature;
    if (top_p !== undefined) geminiRequest.generationConfig.topP = top_p;
    if (top_k !== undefined) geminiRequest.generationConfig.topK = top_k;
    if (stop) geminiRequest.generationConfig.stopSequences = Array.isArray(stop) ? stop : [stop];

    // Enable image generation for models with "image" in the name
    if (model.toLowerCase().includes('image')) {
      geminiRequest.generationConfig.responseModalities = ["IMAGE", "TEXT"];
    }

    // Internal flags
    geminiRequest.__model = model;
    geminiRequest.__stream = stream;

    this.applyCustomRequestParams(geminiRequest, internalRequest.custom_request_params);
    return geminiRequest;
  }

  /**
   * Convert Gemini response to OpenAI format
   */
  async translateResponse(providerResponse, _context = {}) {
    if (!providerResponse) return null;

    // Handle fetch Response object
    let data = providerResponse;
    if (providerResponse instanceof Response) {
      if (!providerResponse.ok) {
        const text = await providerResponse.text();
        throw new Error(`Gemini API error: ${providerResponse.status} ${providerResponse.statusText} - ${text}`);
      }
      data = await providerResponse.json();
    }

    const candidate = data.candidates?.[0];
    if (!candidate) return null;

    const message = {
      role: 'assistant',
      content: null,
    };

    const parts = candidate.content?.parts || [];
    const textParts = parts.filter(p => 'text' in p).map(p => p.text).join('');
    if (textParts) {
      message.content = textParts;
    }

    const functionCalls = parts.filter(p => 'functionCall' in p);
    if (functionCalls.length > 0) {
      message.tool_calls = functionCalls.map((part, index) => ({
        id: `call_${Math.random().toString(36).substr(2, 9)}`, // Gemini doesn't provide IDs, generate one
        type: 'function',
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args),
        },
        index,
      }));
    }

    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Date.now(),
      model: 'gemini', // We might not get the exact model back easily
      choices: [{
        index: 0,
        message,
        finish_reason: this.mapFinishReason(candidate.finishReason),
      }],
      usage: normalizeUsage(data.usageMetadata),
    };
  }

  translateStreamChunk(chunk, _context = {}) {
    if (!chunk) return null;

    // Chunk might be a string (line from SSE) or object
    let data = chunk;
    if (typeof chunk === 'string') {
      try {
        // Remove 'data: ' prefix if present
        const cleaned = chunk.replace(/^data: /, '').trim();
        if (cleaned === '[DONE]') return null;
        data = JSON.parse(cleaned);
      } catch {
        return null;
      }
    }

    const candidate = data.candidates?.[0];
    if (!candidate) {
        logger.debug('[GeminiAdapter] No candidate in chunk', { data });
        return null;
    }

    const delta = { role: 'assistant' };
    const parts = candidate.content?.parts || [];

    // Text delta
    const textParts = parts.filter(p => 'text' in p).map(p => p.text).join('');
    if (textParts) {
      delta.content = textParts;
    }

    // Tool call delta (Gemini usually sends full tool call in one go, but we map it to delta)
    const functionCalls = parts.filter(p => 'functionCall' in p);
    if (functionCalls.length > 0) {
      logger.debug('[GeminiAdapter] Found function calls', { count: functionCalls.length });
      delta.tool_calls = functionCalls.map((part, index) => {
        // Use a stable ID based on responseId if available to support potential multi-chunk tool calls
        // Sanitizing to ensure it's a valid ID string
        const stableId = data.responseId
          ? `call_${data.responseId}_${index}`.replace(/[^a-zA-Z0-9_]/g, '')
          : `call_${Math.random().toString(36).substr(2, 9)}`;

        return {
          index,
          id: stableId,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args),
          },
          // Preserve Gemini thoughtSignature if present for future turns
          gemini_thought_signature: part.thoughtSignature || part.functionCall.thoughtSignature
        };
      });
    }

    let finishReason = this.mapFinishReason(candidate.finishReason);
    if (functionCalls.length > 0) {
      finishReason = 'tool_calls';
    }

    logger.debug('[GeminiAdapter] finishReason resolution', {
        original: candidate.finishReason,
        mapped: finishReason,
        hasContent: !!delta.content,
        hasTools: delta.tool_calls?.length > 0
    });

    // Fix for Gemini sending a STOP chunk after a tool call chunk.
    // If we receive an empty STOP chunk, it often follows a tool call chunk derived from Gemini's behavior.
    // Suppressing this ensures the client preserves the 'tool_calls' finish_reason from the previous chunk.
    if (finishReason === 'stop' && !delta.content && (!delta.tool_calls || delta.tool_calls.length === 0)) {
      logger.debug('[GeminiAdapter] Suppressing empty STOP chunk to preserve tool_calls state');
      return null;
    }

    const result = {
      id: data.responseId ? `chatcmpl-${data.responseId}` : `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Date.now(),
      model: 'gemini',
      choices: [{
        index: 0,
        delta,
        finish_reason: finishReason,
      }],
    };

    const usage = normalizeUsage(data.usageMetadata);
    if (usage) {
      result.usage = usage;
    }

    logger.debug('[GeminiAdapter] Translating chunk result', { result: JSON.stringify(result) });
    return result;
  }

  mapFinishReason(reason) {
    switch (reason) {
      case 'STOP': return 'stop';
      case 'MAX_TOKENS': return 'length';
      case 'SAFETY': return 'content_filter';
      case 'RECITATION': return 'content_filter';
      case 'OTHER': return 'stop';
      default: return null;
    }
  }
}
