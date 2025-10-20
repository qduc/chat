/**
 * Test accurate token speed measurement using actual streaming chunks
 */

import type { Role } from '../lib';
import { chat } from '../lib';

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

describe('Token speed measurement', () => {
  test('counts actual streaming chunks as tokens', async () => {
    // Simulate streaming response with 5 token chunks
    const lines = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" there"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" How"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" are"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" you?"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(sseStream(lines), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );

    const tokens: string[] = [];
    let tokenCount = 0;

    const result = await chat.sendMessage({
      messages: [{ role: 'user' as Role, content: 'test' }],
      providerId: 'openai',
      stream: true,
      onToken: (token) => {
        tokens.push(token);
        tokenCount++;
      },
    });

    // Verify we received exactly 6 token chunks (not estimated from character count)
    expect(tokenCount).toBe(6);
    expect(tokens).toEqual(['Hello', ' there', '!', ' How', ' are', ' you?']);
    expect(result.content).toBe('Hello there! How are you?');
  });

  test('handles empty token chunks correctly', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":""}}]}\n\n', // Empty chunk
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(sseStream(lines), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );

    const tokens: string[] = [];
    let tokenCount = 0;

    const result = await chat.sendMessage({
      messages: [{ role: 'user' as Role, content: 'test' }],
      providerId: 'openai',
      stream: true,
      onToken: (token) => {
        tokens.push(token);
        tokenCount++;
      },
    });

    // Empty content chunks don't trigger onToken, so only 2 calls
    expect(tokenCount).toBe(2);
    expect(tokens).toEqual(['Hello', ' world']);
    expect(result.content).toBe('Hello world');
  });

  test('handles single character tokens', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"content":"H"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"i"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(sseStream(lines), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );

    let tokenCount = 0;

    const result = await chat.sendMessage({
      messages: [{ role: 'user' as Role, content: 'test' }],
      providerId: 'openai',
      stream: true,
      onToken: () => {
        tokenCount++;
      },
    });

    // Each character is a separate token chunk
    expect(tokenCount).toBe(3);
    expect(result.content).toBe('Hi!');
  });

  test('handles multi-character tokens', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"content":"Hello world this is a longer token chunk"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" and another one"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(sseStream(lines), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );

    let tokenCount = 0;

    const result = await chat.sendMessage({
      messages: [{ role: 'user' as Role, content: 'test' }],
      providerId: 'openai',
      stream: true,
      onToken: () => {
        tokenCount++;
      },
    });

    // Only 2 token chunks regardless of character count
    expect(tokenCount).toBe(2);
    expect(result.content).toBe('Hello world this is a longer token chunk and another one');
  });
});
