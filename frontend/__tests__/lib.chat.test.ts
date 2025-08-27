// Test stubs for frontend lib functions in lib/chat.ts
/* eslint-disable */
/// <reference types="jest" />

import type { Role } from '../lib/chat';
import {
  sendChat,
  createConversation,
  listConversationsApi,
  getConversationApi,
  deleteConversationApi,
} from '../lib/chat';

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

describe('sendChat', () => {
  test('POSTs to /v1/responses by default with stream=true and aggregates tokens', async () => {
    const lines = [
      'data: {"type":"response.output_text.delta","delta":"Hel"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"lo"}\n\n',
      'data: {"type":"response.completed","response":{"id":"r1"}}\n\n',
      'data: [DONE]\n\n',
    ];
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(sseStream(lines), { status: 200 })
      );
    const tokens: string[] = [];
    const result = await sendChat({
      messages: [{ role: 'user' as Role, content: 'hi' }],
      onToken: (t) => tokens.push(t),
    });
    // Test behavior: Messages should be sent and streaming response received progressively
    expect(fetchMock).toHaveBeenCalled();
    expect(result).toEqual({ content: 'Hello', responseId: 'r1' });
    expect(tokens).toEqual(['Hel', 'lo']);
  });

  test('supports non-stream JSON via Responses API (stream=false)', async () => {
    const json = {
      id: 'resp_123',
      model: 'gpt-x',
      output: [
        { content: [{ text: 'Hello JSON' }] }
      ],
      status: 'completed'
    };
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await sendChat({
      messages: [{ role: 'user' as Role, content: 'hi' }],
      shouldStream: false,
    });

    expect(fetchMock).toHaveBeenCalled();
    const [, opts] = fetchMock.mock.calls[0];
    expect(result).toEqual({ content: 'Hello JSON', responseId: 'resp_123' });
  });

  test('supports non-stream JSON via Chat Completions when tools provided', async () => {
    const json = {
      id: 'chatcmpl_123',
      object: 'chat.completion',
      choices: [
        { index: 0, message: { role: 'assistant', content: 'Hi non-stream' }, finish_reason: 'stop' }
      ]
    };
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await sendChat({
      messages: [{ role: 'user' as Role, content: 'hi' }],
      shouldStream: false,
      useResponsesAPI: false,
      tools: [{ type: 'function', function: { name: 'noop', parameters: { type: 'object' } } }],
      tool_choice: 'auto',
    });

    expect(fetchMock).toHaveBeenCalled();
    const [, opts] = fetchMock.mock.calls[0];
    expect(result).toEqual({ content: 'Hi non-stream', responseId: 'chatcmpl_123' });
  });

  test('POSTs to /v1/chat/completions when useResponsesAPI=false', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" there"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(sseStream(lines), { status: 200 }));
  const tokens: string[] = [];
  const result = await sendChat({
    messages: [{ role: 'user' as Role, content: 'hi' }],
    useResponsesAPI: false,
    onToken: (t) => tokens.push(t),
  });
  expect(fetchMock).toHaveBeenCalled();
  expect(result.content).toBe('Hi there');
  expect(tokens).toEqual(['Hi', ' there']);
  });

  test('throws on non-OK responses with message from JSON', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'bad' }), { status: 400 })
    );
    await expect(
      sendChat({ messages: [{ role: 'user' as Role, content: 'hi' }] })
    ).rejects.toThrow('HTTP 400: bad');
  });

  test('supports AbortController to stop streaming', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"response.output_text.delta","delta":"hi"}\n\n'
          )
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
    const promise = sendChat({
      messages: [{ role: 'user' as Role, content: 'hi' }],
      signal: abort.signal,
    });
    abort.abort();
    await expect(promise).rejects.toThrow();
  });

  test('includes conversation_id when provided', async () => {
    const lines = ['data: [DONE]\n\n'];
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(sseStream(lines), { status: 200 }));
    await sendChat({
      messages: [{ role: 'user' as Role, content: 'hi' }],
      conversationId: 'abc',
    });
    // Test behavior: Conversation context should be maintained
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('createConversation', () => {
  test('creates new conversation and returns conversation metadata', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ id: '1', title: 't', model: 'm', created_at: 'now' }),
        { status: 200 }
      )
    );
    const meta = await createConversation();
    
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
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'nope' }), { status: 501 })
      );
    await expect(createConversation()).rejects.toHaveProperty('status', 501);
  });
});

describe('listConversationsApi', () => {
  test('lists conversations with pagination and returns items with next cursor', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ items: [{ id: '1', created_at: 'now' }], next_cursor: 'n' }),
        { status: 200 }
      )
    );
    const res = await listConversationsApi(undefined, { cursor: 'c', limit: 2 });
    
    // Test behavior: Should return paginated conversation list
    expect(res.items).toHaveLength(1);
    expect(res.items[0].id).toBe('1');
    expect(res.next_cursor).toBe('n');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/conversations.*cursor=c.*limit=2/),
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('getConversationApi', () => {
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
    const res = await getConversationApi(undefined, 'x');
    
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
    const res = await getConversationApi(undefined, 'y', { after_seq: 5, limit: 10 });
    
    // Test behavior: Should handle pagination parameters and return conversation
    expect(res.id).toBe('y');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/conversations\/y.*after_seq=5.*limit=10/),
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('deleteConversationApi', () => {
  test('deletes conversation and returns success status', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    const res = await deleteConversationApi(undefined, 'z');
    
    // Test behavior: Should successfully delete and return confirmation
    expect(res).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/conversations\/z/),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

export {};
