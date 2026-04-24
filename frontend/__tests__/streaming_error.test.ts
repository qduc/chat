/**
 * Regression test for streaming error handling
 * @jest-environment jsdom
 */

import { chat } from '../lib/api';

const encoder = new TextEncoder();
function sseStream(lines: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });
}

function createSSEResponse(lines: string[]) {
  return new Response(sseStream(lines), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('Chat Streaming Error Handling', () => {
  it('returns an error response when finish_reason is error and content contains error message', async () => {
    const errorLines = [
      'data: {"_conversation":{"id":"conv-1"}}\n\n',
      'data: {"id":"error","choices":[{"index":0,"delta":{"content":"[Error: No endpoints available]"},"finish_reason":"error"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    jest.spyOn(global, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/v1/chat/completions')) {
        return Promise.resolve(createSSEResponse(errorLines));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const response = await chat.sendMessage({
      messages: [{ role: 'user', content: 'hello', id: 'm1' }],
      model: 'test-model',
      providerId: 'test-provider',
    });

    expect(response.status).toBe('error');
    expect(response.finish_reason).toBe('error');
    expect(response.content).toBe('[Error: No endpoints available]');
    expect(response.message_events).toEqual([
      { seq: 1, type: 'content', payload: { text: '[Error: No endpoints available]' } },
    ]);
  });

  it('handles normal stream without throwing error', async () => {
    const normalLines = [
      'data: {"choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    jest.spyOn(global, 'fetch').mockResolvedValueOnce(createSSEResponse(normalLines));

    const response = await chat.sendMessage({
      messages: [{ role: 'user', content: 'hello', id: 'm2' }],
      model: 'test-model',
      providerId: 'test-provider',
    });

    expect(response.content).toBe('Hello');
  });
});
