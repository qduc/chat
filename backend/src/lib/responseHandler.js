import { setupStreamingHeaders } from './streamingHandler.js';

export function isStreamingResponse(upstream, requestedStream) {
  return requestedStream &&
         !upstream.headers.get('content-type')?.includes('application/json');
}

export async function handleNonStreamingResponse(upstream, req, useResponsesAPI, persistenceManager) {
  const json = await upstream.json();

  // Only handle Chat Completions API format
  let content = null;
  let finishReason = null;
  let responseToSend = json;

  if (json?.choices?.[0]?.message?.content) {
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
