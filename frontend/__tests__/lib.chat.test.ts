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
  expect(fetchMock).toHaveBeenCalled();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/responses');
  const body = JSON.parse(opts!.body as string);
  expect(body.stream).toBe(true);
  expect((opts!.headers as any)['Accept']).toBe('text/event-stream');
    expect(result).toEqual({ content: 'Hello', responseId: 'r1' });
    expect(tokens).toEqual(['Hel', 'lo']);
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
  const calledUrls = fetchMock.mock.calls.map((c: any) => c[0]);
  expect(calledUrls).toContain('/api/v1/chat/completions');
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
  const calls = fetchMock.mock.calls;
  const lastOpts = calls[calls.length - 1][1];
  const body = JSON.parse((lastOpts!).body as string);
  expect(body.conversation_id).toBe('abc');
  });
});

describe('createConversation', () => {
  test('POSTs to /v1/conversations and returns ConversationMeta', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ id: '1', title: 't', model: 'm', created_at: 'now' }),
        { status: 200 }
      )
    );
    const meta = await createConversation();
    expect(meta.id).toBe('1');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/conversations',
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
  test('GETs /v1/conversations with cursor+limit and returns items/next_cursor', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ items: [{ id: '1', created_at: 'now' }], next_cursor: 'n' }),
        { status: 200 }
      )
    );
    const res = await listConversationsApi(undefined, { cursor: 'c', limit: 2 });
    expect(res.next_cursor).toBe('n');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/conversations?cursor=c&limit=2',
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('getConversationApi', () => {
  test('GETs /v1/conversations/:id and returns metadata+messages', async () => {
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
    expect(res.id).toBe('x');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/conversations/x?',
      expect.objectContaining({ method: 'GET' })
    );
  });

  test('supports after_seq and limit', async () => {
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
    await getConversationApi(undefined, 'y', { after_seq: 5, limit: 10 });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/conversations/y?after_seq=5&limit=10',
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('deleteConversationApi', () => {
  test('DELETEs /v1/conversations/:id and returns true on 204', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    const res = await deleteConversationApi(undefined, 'z');
    expect(res).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/conversations/z',
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

export {};
