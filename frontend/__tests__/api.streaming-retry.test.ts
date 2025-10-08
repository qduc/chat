/**
 * Test automatic retry with streaming disabled when receiving
 * "Your organization must be verified to stream this model" error
 */

import type { Role } from '../lib';
import { chat } from '../lib';
import { StreamingNotSupportedError } from '../lib/streaming';

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

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Streaming retry on verification error', () => {
  test('throws StreamingNotSupportedError when receiving organization verification error', async () => {
    const errorMessage = 'Your organization must be verified to stream this model. Please go to: https://platform.openai.com/settings/organization/general';

    const lines = [
      `data: {"choices":[{"delta":{"content":"${errorMessage}"}}]}\n\n`,
      'data: [DONE]\n\n',
    ];

    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(sseStream(lines), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    );

    await expect(
      chat.sendMessage({
        messages: [{ role: 'user' as Role, content: 'test' }],
        providerId: 'openai',
        stream: true,
      })
    ).rejects.toThrow(StreamingNotSupportedError);
  });

  test('does not throw for normal content with partial match', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"content":"Your organization"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" is great!"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(sseStream(lines), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    );

    const tokens: string[] = [];
    const result = await chat.sendMessage({
      messages: [{ role: 'user' as Role, content: 'test' }],
      providerId: 'openai',
      stream: true,
      onToken: (token) => tokens.push(token),
    });

    expect(result.content).toBe('Your organization is great!');
    expect(tokens.join('')).toBe('Your organization is great!');
  });

  test('throws when error is in error message format', async () => {
    const errorMessage = '[Error: Upstream API error (400): Your organization must be verified to stream this model]';

    const lines = [
      `data: {"choices":[{"delta":{"content":"${errorMessage}"}}]}\n\n`,
      'data: [DONE]\n\n',
    ];

    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(sseStream(lines), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    );

    await expect(
      chat.sendMessage({
        messages: [{ role: 'user' as Role, content: 'test' }],
        providerId: 'openai',
        stream: true,
      })
    ).rejects.toThrow(StreamingNotSupportedError);
  });
});
