import { parseSSEStream } from './sseParser.js';
import { writeAndFlush } from './streamUtils.js';
import { normalizeUsage } from './utils/usage.js';
import { getConversationMetadata } from './responseUtils.js';
import { logger } from '../logger.js';

export { setupStreamingHeaders } from './streamUtils.js';

/**
 * Set up common stream event handlers for upstream response and client request
 * @param {Object} params - Handler setup parameters
 * @param {Object} params.upstream - Upstream response object
 * @param {Object} params.req - Express request object
 * @param {Object} params.res - Express response object
 * @param {Object} params.persistence - Simplified persistence manager
 * @param {Object} params.lastFinishReason - Reference to finish reason variable
 * @param {Map} params.toolCallMap - Accumulated tool calls during streaming
 */
function setupStreamEventHandlers({
  upstream,
  req,
  res,
  persistence,
  lastFinishReason,
  toolCallMap,
  abortContext,
  onComplete,
}) {
  // One-shot guard to prevent double finalize/error on error+end sequences
  let completed = false;

  let abortHandler = null;
  const finalize = (overrideFinishReason = null) => {
    if (completed) return;
    completed = true;
    try {
      if (abortHandler && abortContext?.signal) {
        abortContext.signal.removeEventListener('abort', abortHandler);
      }
      if (persistence && persistence.persist) {
        // Add accumulated tool calls to persistence before finalizing
        if (toolCallMap && toolCallMap.size > 0) {
          const toolCalls = Array.from(toolCallMap.values());
          logger.debug('[streamingHandler] Adding tool calls to persistence', {
            count: toolCalls.length,
            callIds: toolCalls.map(tc => tc?.id)
          });
          persistence.addToolCalls(toolCalls);
        }

        const finishReason = overrideFinishReason
          || (typeof lastFinishReason === 'object' && lastFinishReason !== null ? lastFinishReason.value : lastFinishReason)
          || 'stop';
        persistence.recordAssistantFinal({ finishReason });
      }
    } catch (e) {
      logger.error('[persist] finalize error', e);
    } finally {
      onComplete?.();
    }
    if (!res.writableEnded) {
      return res.end();
    }
    return undefined;
  };

  upstream.body.on('end', () => finalize());

  upstream.body.on('error', (err) => {
    logger.error('Upstream stream error', err);
    if (completed) return res.end();
    if (abortContext?.cancelState?.cancelled) {
      return finalize('cancelled');
    }
    completed = true;
    try {
      if (persistence && persistence.persist) {
        persistence.markError();
      }
    } catch {
      // Ignore errors
    } finally {
      onComplete?.();
    }
    return res.end();
  });

  req.on('close', () => {
    if (res.writableEnded) return;
    try {
      if (abortContext?.cancelState?.cancelled) {
        return;
      }
      if (persistence && persistence.persist) {
        persistence.markError();
      }
    } catch {
      // Ignore errors
    }
  });
  // Also handle response socket close to catch client aborts in all environments
  res.on('close', () => {
    if (res.writableEnded) return;
    try {
      if (abortContext?.cancelState?.cancelled) {
        return;
      }
      if (persistence && persistence.persist) {
        persistence.markError();
      }
    } catch {
      // Ignore errors
    }
  });

  if (abortContext?.signal) {
    abortHandler = () => {
      if (abortContext?.cancelState?.cancelled) {
        try {
          upstream.body?.destroy?.();
        } catch {
          // Ignore destroy errors
        }
        finalize('cancelled');
      }
    };
    if (abortContext.signal.aborted) {
      abortHandler();
    } else {
      abortContext.signal.addEventListener('abort', abortHandler, { once: true });
    }
  }
}

/**
 * Process a parsed chunk for persistence
 */
function processPersistenceChunk(obj, persistence, toolCallMap, lastFinishReason) {
  let finishReason = null;

  // Capture response_id from any chunk
  if (obj?.id) {
    persistence.setResponseId(obj.id);
  }

  if (obj?.provider && typeof persistence.setProvider === 'function') {
    persistence.setProvider(obj.provider);
  }

  const choice = obj?.choices?.[0];
  const delta = choice?.delta;

  if (delta) {
    const deltaContent = delta.content;
    if (deltaContent !== undefined) {
      persistence.appendContent(deltaContent);
    }

    const reasoningText = delta.reasoning_content ?? delta.reasoning;
    if (reasoningText) {
      persistence.appendReasoningText(reasoningText);
    }

    if (Array.isArray(delta.reasoning_details) && delta.reasoning_details.length > 0) {
      persistence.setReasoningDetails(delta.reasoning_details);
    }

    // Capture tool_calls from delta (streaming tool calls)
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
      for (const tcDelta of delta.tool_calls) {
        const idx = tcDelta.index ?? 0;
        const isNewToolCall = !toolCallMap.has(idx);

        const existing = toolCallMap.get(idx) || {
          id: tcDelta.id,
          type: 'function',
          index: idx,
          function: { name: '', arguments: '' }
        };

        // Capture textOffset when tool call first appears
        if (isNewToolCall && persistence) {
          existing.textOffset = persistence.getContentLength();
          if (typeof persistence.addMessageEvent === 'function') {
            persistence.addMessageEvent('tool_call', {
              tool_call_id: tcDelta.id ?? null,
              tool_call_index: idx,
            });
          }
        }

        if (tcDelta.id) existing.id = tcDelta.id;
        if (tcDelta.type) existing.type = tcDelta.type;
        if (tcDelta.function?.name) {
          existing.function.name = tcDelta.function.name;
        }
        if (tcDelta.function?.arguments) {
          existing.function.arguments += tcDelta.function.arguments;
        }

        toolCallMap.set(idx, existing);
      }
    }

    finishReason = choice?.finish_reason ?? finishReason;
  }

  // Capture reasoning_tokens from usage (check both locations)
  const reasoningTokens = obj?.usage?.reasoning_tokens
    ?? obj?.usage?.completion_tokens_details?.reasoning_tokens
    ?? null;
  if (reasoningTokens != null) {
    persistence.setReasoningTokens(reasoningTokens);
  }

  if (obj?.usage) {
    const normalizedUsage = normalizeUsage(obj.usage);
    if (normalizedUsage && typeof persistence.setUsage === 'function') {
      persistence.setUsage(normalizedUsage);
    }
  }

  const message = choice?.message;
  if (message?.reasoning_details) {
    persistence.setReasoningDetails(message.reasoning_details);
  }

  // Capture complete tool_calls from message (non-streaming or final)
  if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
    for (const toolCall of message.tool_calls) {
      const idx = toolCall.index ?? toolCallMap.size;
      toolCallMap.set(idx, toolCall);
    }
  }

  if (finishReason) {
    lastFinishReason.value = finishReason;
  }
}

/**
 * Handle regular streaming (non-tool orchestration)
 * @param {Object} params - Streaming parameters
 */
export async function handleRegularStreaming({
  upstream,
  res,
  req,
  persistence,
  provider,
  abortContext,
  onComplete,
}) {
  let leftover = '';
  let translationLeftover = '';
  let lastFinishReason = { value: null };
  let toolCallMap = new Map(); // Accumulate streamed tool calls

  // Emit conversation metadata upfront if available so clients receive
  // the conversation id before any model chunks or [DONE]
  try {
    const conversationMeta = getConversationMetadata(persistence);
    if (conversationMeta) {
      writeAndFlush(res, `data: ${JSON.stringify(conversationMeta)}\n\n`);
    }
  } catch (e) {
    // Non-fatal: continue streaming even if metadata cannot be serialized
    logger.warn('[stream] failed to write conversation metadata early', e?.message || e);
  }

  upstream.body.on('data', (chunk) => {
    try {
      if (provider?.needsStreamingTranslation()) {
        // Translate chunks before writing and persistence
        translationLeftover = parseSSEStream(
          chunk,
          translationLeftover,
          (obj) => {
            logger.debug('[StreamingHandler] Raw chunk received from upstream', {
                id: obj?.id,
                hasCandidates: !!obj?.candidates,
                finishReason: obj?.candidates?.[0]?.finishReason
            });

            const translated = provider.translateStreamChunk(obj);

            logger.debug('[StreamingHandler] Translation result', {
                 translatedResult: translated === '[DONE]' ? 'DONE' : (translated ? 'CHUNK' : 'NULL'),
                 translatedId: typeof translated === 'object' ? translated?.id : undefined
            });

            if (translated === '[DONE]') {
              writeAndFlush(res, 'data: [DONE]\n\n');
            } else if (translated) {
              writeAndFlush(res, `data: ${JSON.stringify(translated)}\n\n`);

              // Update persistence with translated chunk
              if (persistence && persistence.persist) {
                processPersistenceChunk(translated, persistence, toolCallMap, lastFinishReason);
              }
            }
          },
          () => {
             writeAndFlush(res, 'data: [DONE]\n\n');
          },
          (err) => {
             logger.warn('Error parsing upstream SSE JSON for translation', err);
          }
        );
      } else {
        // Direct passthrough for Chat Completions API
        writeAndFlush(res, chunk);

        // Update persistence buffer if enabled
        if (persistence && persistence.persist) {
          leftover = parseSSEStream(
            chunk,
            leftover,
            (obj) => {
              processPersistenceChunk(obj, persistence, toolCallMap, lastFinishReason);
            },
            () => { },
            () => { }
          );
        }
      }
    } catch (e) {
      logger.error('[stream data] error', e);
    }
  });

  setupStreamEventHandlers({
    upstream,
    req,
    res,
    persistence,
    lastFinishReason,
    toolCallMap,
    abortContext,
    onComplete,
  });
}
