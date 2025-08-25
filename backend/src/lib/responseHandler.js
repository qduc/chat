import { setupStreamingHeaders } from './streamingHandler.js';

export function isStreamingResponse(upstream, requestedStream) {
  return requestedStream && 
         !upstream.headers.get('content-type')?.includes('application/json');
}

export async function handleNonStreamingResponse(upstream, req, useResponsesAPI, persistenceManager) {
  const json = await upstream.json();
  
  // Handle different response formats and convert if needed
  let content = null;
  let finishReason = null;
  let responseToSend = json;

  if (useResponsesAPI && json?.output?.[0]?.content?.[0]?.text) {
    // Responses API format - extract content
    content = json.output[0].content[0].text;
    finishReason = json.status === 'completed' ? 'stop' : null;

    // Convert to Chat Completions format for /v1/chat/completions endpoint
    if (req.path === '/v1/chat/completions') {
      responseToSend = convertToChatCompletionsFormat(json, content, finishReason);
    }
  } else if (json?.choices?.[0]?.message?.content) {
    // Chat Completions API format
    content = json.choices[0].message.content;
    finishReason = json.choices[0].finish_reason;
  }

  // Handle persistence for non-streaming responses
  persistenceManager.handleNonStreaming({ content, finishReason });

  return {
    status: upstream.status,
    response: responseToSend
  };
}

export function setupStreaming(res) {
  setupStreamingHeaders(res);
}

function convertToChatCompletionsFormat(json, content, finishReason) {
  return {
    id: json.id,
    object: 'chat.completion',
    created: json.created_at,
    model: json.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: content,
        },
        finish_reason: finishReason,
      },
    ],
    usage: json.usage,
  };
}