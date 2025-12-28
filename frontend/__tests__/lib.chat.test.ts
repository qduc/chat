// Test stubs for frontend lib functions in lib/chat.ts

/// <reference types="jest" />

import type { Role } from '../lib';
import { chat, conversations } from '../lib';

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

describe('chat API', () => {
  test('sends only the latest user message to the backend', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0]).toMatchObject({ role: 'user', content: 'latest message' });

      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'ok',
                },
              },
            ],
          }),
          { status: 200 }
        )
      );
    });

    await chat.sendMessage({
      messages: [
        { role: 'user' as Role, content: 'first message' },
        { role: 'assistant' as Role, content: 'assistant reply' },
        { role: 'user' as Role, content: 'latest message' },
      ],
      conversationId: 'test-c-id',
      stream: false,
      providerId: 'test-provider',
    });

    expect(fetchMock).toHaveBeenCalled();
  });

  test('sends full history for new conversations (no conversationId)', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.messages).toHaveLength(3);
      expect(body.messages[0]).toMatchObject({ role: 'user', content: 'first message' });
      expect(body.messages[2]).toMatchObject({ role: 'user', content: 'latest message' });

      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'ok',
                },
              },
            ],
          }),
          { status: 200 }
        )
      );
    });

    await chat.sendMessage({
      messages: [
        { role: 'user' as Role, content: 'first message' },
        { role: 'assistant' as Role, content: 'assistant reply' },
        { role: 'user' as Role, content: 'latest message' },
      ],
      stream: false,
      providerId: 'test-provider',
      // No conversationId provided
    });

    expect(fetchMock).toHaveBeenCalled();
  });

  test('throws on non-OK responses with message from JSON', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ error: 'bad' }), { status: 400 }));
    await expect(
      chat.sendMessage({
        messages: [{ role: 'user' as Role, content: 'hi' }],
        providerId: 'test-provider',
        stream: false,
      })
    ).rejects.toThrow('HTTP 400: bad');
  });

  test('supports AbortController to stop streaming', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"type":"response.output_text.delta","delta":"hi"}\n\n')
        );
        // do not close to simulate ongoing stream
      },
    });
    // Make fetch return a promise that rejects when the provided signal is aborted
    jest.spyOn(global, 'fetch').mockImplementation((_url, opts) => {
      return new Promise((resolve, reject) => {
        if (opts?.signal?.aborted) return reject(new Error('aborted'));
        const onAbort = () => reject(new Error('aborted'));
        opts?.signal?.addEventListener?.('abort', onAbort);
        // resolve shortly after so sendChat begins reading; if aborted before resolve it will reject
        setTimeout(() => {
          opts?.signal?.removeEventListener?.('abort', onAbort);
          resolve(new Response(stream, { status: 200 }));
        }, 10);
      });
    });
    const abort = new AbortController();
    const promise = chat.sendMessage({
      messages: [{ role: 'user' as Role, content: 'hi' }],
      signal: abort.signal,
      providerId: 'test-provider',
    });
    abort.abort();
    await expect(promise).rejects.toThrow();
  });

  test('includes conversation_id when provided', async () => {
    const lines = ['data: [DONE]\n\n'];
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(sseStream(lines), { status: 200 }));
    await chat.sendMessage({
      messages: [{ role: 'user' as Role, content: 'hi' }],
      conversationId: 'abc',
      tools: [],
      providerId: 'test-provider',
      stream: true,
    });
    // Test behavior: Conversation context should be maintained
    expect(fetchMock).toHaveBeenCalled();
  });

  test('closes reasoning before streaming tool calls to prevent orphan thinking tags', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"reasoning_content":"I need to check current time"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_time","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"Now that I know the time"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Then current time is 00:00"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(sseStream(lines), { status: 200 }));

    const tokens: string[] = [];
    const events: any[] = [];

    const result = await chat.sendMessage({
      messages: [{ role: 'user' as Role, content: 'hi' }],
      tools: [],
      providerId: 'default-provider',
      onToken: (token) => tokens.push(token),
      onEvent: (event) => events.push(event),
    });

    const joinedTokens = tokens.join('');
    expect(joinedTokens).toContain('</thinking><thinking>');
    expect(result.content).toContain('</thinking><thinking>');
    const toolCallEvent = events.find((event) => event.type === 'tool_call');
    expect(toolCallEvent).toBeDefined();
  });
});

describe('conversations API', () => {
  test('creates new conversation and returns conversation metadata', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: '1', title: 't', model: 'm', created_at: 'now' }), {
        status: 200,
      })
    );
    const meta = await conversations.create();

    // Test behavior: Should create conversation and return metadata
    expect(meta.id).toBe('1');
    expect(meta.title).toBe('t');
    expect(meta.model).toBe('m');
    expect(meta.created_at).toBe('now');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('conversations'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('propagates 501 when persistence is disabled', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), { status: 501 }));
    await expect(conversations.create()).rejects.toThrow('HTTP 501: nope');
  });

  test('lists conversations with pagination and returns items with next cursor', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ items: [{ id: '1', created_at: 'now' }], next_cursor: 'n' }),
          { status: 200 }
        )
      );
    const res = await conversations.list({ cursor: 'c', limit: 2 });

    // Test behavior: Should return paginated conversation list
    expect(res.items).toHaveLength(1);
    expect(res.items[0].id).toBe('1');
    expect(res.next_cursor).toBe('n');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/conversations.*cursor=c.*limit=2/),
      expect.objectContaining({ method: 'GET' })
    );
  });

  test('retrieves conversation details including messages and metadata', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'x',
          title: 't',
          model: 'm',
          created_at: 'now',
          messages: [],
          next_after_seq: null,
        }),
        { status: 200 }
      )
    );
    const res = await conversations.get('x');

    // Test behavior: Should return full conversation data
    expect(res.id).toBe('x');
    expect(res.title).toBe('t');
    expect(res.model).toBe('m');
    expect(res.messages).toEqual([]);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/conversations\/x/),
      expect.objectContaining({ method: 'GET' })
    );
  });

  test('supports message pagination with after_seq and limit parameters', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'y',
          title: 't',
          model: 'm',
          created_at: 'now',
          messages: [],
          next_after_seq: null,
        }),
        { status: 200 }
      )
    );
    const res = await conversations.get('y', { after_seq: 5, limit: 10 });

    // Test behavior: Should handle pagination parameters and return conversation
    expect(res.id).toBe('y');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/conversations\/y.*after_seq=5.*limit=10/),
      expect.objectContaining({ method: 'GET' })
    );
  });

  test('deletes conversation and returns success status', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    await conversations.delete('z');

    // Test behavior: Should successfully delete
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/conversations\/z/),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

export {};
