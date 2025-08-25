
/**
 * Set up streaming response headers
 * @param {Object} res - Express response object
 */
export function setupStreamingHeaders(res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Ensure headers are sent immediately so the client can start processing
  // the event stream as soon as chunks arrive. Some proxies/browsers may
  // buffer the response if headers are not flushed explicitly.
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
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
  persist,
  assistantMessageId,
  appendAssistantContent,
  finalizeAssistantMessage,
  markAssistantError,
  buffer,
  flushedOnce,
  sizeThreshold,
  useResponsesAPI,
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

  let leftover = '';
  let finished = false;
  let lastFinishReason = null;

  upstream.body.on('data', (chunk) => {
    try {
      const s = String(chunk);

      // Handle stream format conversion if needed
      if (useResponsesAPI && req.path === '/v1/chat/completions') {
        // Convert Responses API streaming to Chat Completions format
        let data = leftover + s;
        const parts = data.split(/\n\n/);
        leftover = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            const dataMatch = line.match(/^data:\s*(.*)$/);

            if (dataMatch) {
              const payload = dataMatch[1];
              if (payload === '[DONE]') {
                res.write('data: [DONE]\n\n');
                finished = true;
                break;
              }

              try {
                const obj = JSON.parse(payload);

                // Convert Responses API events to Chat Completions format
                if (obj.type === 'response.output_text.delta' && obj.delta) {
                  const chatCompletionChunk = {
                    id: obj.item_id,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: 'gpt-3.5-turbo',
                    choices: [
                      {
                        index: 0,
                        delta: { content: obj.delta },
                        finish_reason: null,
                      },
                    ],
                  };
                  res.write(
                    `data: ${JSON.stringify(chatCompletionChunk)}\n\n`
                  );

                  // Handle persistence
                  if (persist && obj.delta) {
                    buffer.value += obj.delta;
                    if (buffer.value.length >= sizeThreshold) doFlush();
                  }
                } else if (obj.type === 'response.completed') {
                  const chatCompletionChunk = {
                    id: obj.response.id,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: obj.response.model,
                    choices: [
                      {
                        index: 0,
                        delta: {},
                        finish_reason: 'stop',
                      },
                    ],
                  };
                  res.write(
                    `data: ${JSON.stringify(chatCompletionChunk)}\n\n`
                  );
                  lastFinishReason = 'stop';
                }
              } catch (e) {
                // not JSON; ignore
              }
            }
          }
        }
        if (typeof res.flush === 'function') res.flush();
      } else {
        // Direct passthrough for native format or Chat Completions API
        res.write(chunk);
        if (typeof res.flush === 'function') res.flush();

        if (!persist) return;

        let data = leftover + s;
        const parts = data.split(/\n\n/);
        leftover = parts.pop() || '';
        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            const m = line.match(/^data:\s*(.*)$/);
            if (!m) continue;
            const payload = m[1];
            if (payload === '[DONE]') {
              finished = true;
              break;
            }
            try {
              const obj = JSON.parse(payload);

              // Handle persistence for different formats
              let deltaContent = null;
              let finishReason = null;

              if (
                useResponsesAPI &&
                obj.type === 'response.output_text.delta'
              ) {
                deltaContent = obj.delta;
              } else if (obj?.choices?.[0]?.delta?.content) {
                deltaContent = obj.choices[0].delta.content;
                finishReason = obj.choices[0].finish_reason;
              }

              if (deltaContent) {
                buffer.value += deltaContent;
                if (buffer.value.length >= sizeThreshold) doFlush();
              }
              if (finishReason) {
                lastFinishReason = finishReason;
              }
            } catch (e) {
              // not JSON; ignore
            }
          }
        }
      }
    } catch (e) {
      console.error('[stream data] error', e);
    }
  });

  upstream.body.on('end', () => {
    try {
      if (persist && assistantMessageId) {
        doFlush();
        finalizeAssistantMessage({
          messageId: assistantMessageId,
          finishReason: lastFinishReason || 'stop',
          status: 'final',
        });
      }
    } catch (e) {
      console.error('[persist] finalize error', e);
    }
    return res.end();
  });

  upstream.body.on('error', (err) => {
    console.error('Upstream stream error', err);
    try {
      if (persist && assistantMessageId) {
        doFlush();
        markAssistantError({ messageId: assistantMessageId });
      }
    } catch {
      // Ignore errors
    }
    return res.end();
  });

  req.on('close', () => {
    if (res.writableEnded) return;
    try {
      if (persist && assistantMessageId) {
        doFlush();
        markAssistantError({ messageId: assistantMessageId });
      }
    } catch {
      // Ignore errors
    }
  });
}