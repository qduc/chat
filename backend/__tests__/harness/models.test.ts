/**
 * Streams recorded upstream responses through each provider's `Model` wrapper.
 * The provider classes and adapters are the real ones; only `fetch` is
 * replaced, so this covers request translation, stream translation and the
 * chunk -> ModelEvent mapping end to end.
 */
import { describe, expect, jest, test } from '@jest/globals';
import { OpenAIProvider } from '../../src/lib/providers/openaiProvider.js';
import { AnthropicProvider } from '../../src/lib/providers/anthropicProvider.js';
import { GeminiProvider } from '../../src/lib/providers/geminiProvider.js';
import { LlamaCppProvider } from '../../src/lib/providers/llamaCppProvider.js';
import { AnthropicModel, GeminiModel, LlamaCppModel, OpenAIModel, createModel, createModelRegistry } from '../../src/lib/harness/models.ts';
import { ModelFailure } from '@qduc/agent-core';
import type { Item, ItemId, ModelEvent, ModelRequest, ToolCallId } from '@qduc/agent-core';

const config = { providerConfig: { streamTimeoutMs: 2_000 } };

type FetchCall = { url: string; body: Record<string, unknown> };

function sse(frames: readonly unknown[], { done = true, events = false } = {}): string {
  const lines = frames.map((frame) => {
    const data = `data: ${JSON.stringify(frame)}\n\n`;
    const type = (frame as { type?: string }).type;
    return events && type ? `event: ${type}\n${data}` : data;
  });
  return lines.join('') + (done ? 'data: [DONE]\n\n' : '');
}

/** A fetch that answers each call with the next recorded response, split into small chunks. */
function recordedFetch(...responses: Array<{ status?: number; body: string; contentType?: string }>) {
  const calls: FetchCall[] = [];
  const fetch = jest.fn(async (url: unknown, init: unknown) => {
    const { body } = init as { body: string };
    calls.push({ url: String(url), body: JSON.parse(body) });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    const encoder = new TextEncoder();
    // Split mid-frame to exercise SSE reassembly.
    const pieces = next.body.match(/[\s\S]{1,37}/g) ?? [];
    const stream = new ReadableStream({
      start(controller) {
        for (const piece of pieces) controller.enqueue(encoder.encode(piece));
        controller.close();
      },
    });
    return new Response(stream, {
      status: next.status ?? 200,
      headers: { 'content-type': next.contentType ?? 'text/event-stream' },
    });
  });
  return { fetch, calls };
}

const user = (text: string): Item => ({
  type: 'user_message',
  id: 'u1' as ItemId,
  content: [{ type: 'text', text }],
});

function request(model: string, input: Item[], extra: Partial<ModelRequest> = {}): ModelRequest {
  return {
    model: { provider: 'p1', model },
    instructions: 'Be brief.',
    input,
    tools: [
      {
        name: 'web_search',
        description: 'Search the web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
    ],
    ...extra,
  };
}

async function collect(stream: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const text = (events: ModelEvent[]) =>
  events.flatMap((e) => (e.type === 'text_delta' ? [e.delta] : [])).join('');
const reasoning = (events: ModelEvent[]) =>
  events.flatMap((e) => (e.type === 'reasoning_delta' ? [e.delta] : [])).join('');
const items = (events: ModelEvent[]) => events.flatMap((e) => (e.type === 'item' ? [e.item] : []));
const done = (events: ModelEvent[]) => events.find((e) => e.type === 'done') as Extract<ModelEvent, { type: 'done' }>;

describe('OpenAIModel (Chat Completions)', () => {
  const chunks = [
    { id: 'chatcmpl-1', model: 'gpt-x', choices: [{ index: 0, delta: { role: 'assistant', content: 'Let me ' } }] },
    { id: 'chatcmpl-1', choices: [{ index: 0, delta: { content: 'check.' } }] },
    {
      id: 'chatcmpl-1',
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"que' } }] },
        },
      ],
    },
    { id: 'chatcmpl-1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"node 24"}' } }] } }] },
    { id: 'chatcmpl-1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    {
      id: 'chatcmpl-1',
      choices: [],
      usage: { prompt_tokens: 20, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 4 } },
    },
  ];

  test('streams text and a tool call, then usage and done', async () => {
    const { fetch, calls } = recordedFetch({ body: sse(chunks) });
    const provider = new OpenAIProvider({
      config,
      providerId: 'p1',
      http: fetch,
      settings: { providerType: 'openai-completions', apiKey: 'k', baseUrl: 'https://api.example.test' },
    });
    const model = createModel({ provider, model: 'gpt-x', config });
    expect(model).toBeInstanceOf(OpenAIModel);

    const events = await collect(model.stream(request('gpt-x', [user('Node 24?')]), new AbortController().signal));

    expect(calls[0]!.body).toMatchObject({
      model: 'gpt-x',
      stream: true,
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Node 24?' },
      ],
      tools: [{ type: 'function', function: { name: 'web_search' } }],
    });
    expect(text(events)).toBe('Let me check.');
    expect(items(events)).toEqual([
      expect.objectContaining({ type: 'assistant_message', content: [{ type: 'text', text: 'Let me check.' }] }),
      expect.objectContaining({
        type: 'tool_call',
        callId: 'call_1',
        toolName: 'web_search',
        input: { query: 'node 24' },
        rawArguments: '{"query":"node 24"}',
      }),
    ]);
    expect(events.find((e) => e.type === 'usage')).toEqual({
      type: 'usage',
      usage: { inputTokens: 20, outputTokens: 9, cachedInputTokens: 4 },
    });
    expect(done(events)).toMatchObject({ stopReason: 'tool_use', continuation: 'chatcmpl-1' });
    expect(events.at(-1)!.type).toBe('done');
    // Progress events carry the growing argument length.
    const progress = events.filter((e) => e.type === 'tool_call_streaming_delta');
    expect(progress.at(-1)).toMatchObject({ argumentCharCount: 19, toolName: 'web_search', callId: 'call_1' });
  });

  test('replays history with tool results and no continuation for Chat Completions', async () => {
    const { fetch, calls } = recordedFetch({
      body: sse([{ id: 'chatcmpl-2', choices: [{ index: 0, delta: { content: 'Done.' }, finish_reason: 'stop' }] }]),
    });
    const provider = new OpenAIProvider({
      config,
      providerId: 'p1',
      http: fetch,
      settings: { providerType: 'openai-completions', apiKey: 'k', baseUrl: 'https://api.example.test' },
    });
    const model = createModel({ provider, model: 'gpt-x', config });
    const history: Item[] = [
      user('Node 24?'),
      { type: 'assistant_message', id: 'a1' as ItemId, content: [{ type: 'text', text: 'Let me check.' }] },
      {
        type: 'tool_call',
        id: 't1' as ItemId,
        callId: 'call_1' as ToolCallId,
        toolName: 'web_search',
        input: { query: 'node 24' },
        rawArguments: '{"query":"node 24"}',
      },
      { type: 'tool_result', id: 'r1' as ItemId, callId: 'call_1' as ToolCallId, output: '{"ok":true}', isError: false },
    ];

    const events = await collect(
      model.stream(request('gpt-x', history, { continuation: 'chatcmpl-1' }), new AbortController().signal),
    );

    expect(calls[0]!.body.previous_response_id).toBeUndefined();
    expect(calls[0]!.body.messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Node 24?' },
      {
        role: 'assistant',
        content: 'Let me check.',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"node 24"}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
    ]);
    expect(done(events).stopReason).toBe('end_turn');
  });

  test('upstream errors become a ModelFailure with a kind', async () => {
    const { fetch } = recordedFetch({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'bad key' } }),
    });
    const provider = new OpenAIProvider({
      config,
      providerId: 'p1',
      http: fetch,
      settings: { providerType: 'openai-completions', apiKey: 'k', baseUrl: 'https://api.example.test' },
    });
    const model = createModel({ provider, model: 'gpt-x', config });

    const failure = await collect(model.stream(request('gpt-x', [user('hi')]), new AbortController().signal)).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ModelFailure);
    expect(failure).toMatchObject({ kind: 'authentication', retryable: false, message: expect.stringContaining('bad key') });
  });

  test('abort ends the stream as a cancelled ModelFailure', async () => {
    const controller = new AbortController();
    const fetch = jest.fn(async (_url: unknown, init: unknown) => {
      const { signal } = init as { signal: AbortSignal };
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(sse([{ id: 'x', choices: [{ index: 0, delta: { content: 'partial' } }] }], { done: false })));
          signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    });
    const provider = new OpenAIProvider({
      config,
      providerId: 'p1',
      http: fetch,
      settings: { providerType: 'openai-completions', apiKey: 'k', baseUrl: 'https://api.example.test' },
    });
    const model = createModel({ provider, model: 'gpt-x', config });

    const seen: ModelEvent[] = [];
    const failure = await (async () => {
      for await (const event of model.stream(request('gpt-x', [user('hi')]), controller.signal)) {
        seen.push(event);
        if (event.type === 'text_delta') controller.abort();
      }
    })().catch((error: unknown) => error);

    expect(text(seen)).toBe('partial');
    expect(failure).toMatchObject({ kind: 'cancelled' });
  });
});

describe('OpenAIModel (Responses API)', () => {
  const responsesStream = (id: string, textOut: string) =>
    sse(
      [
        { type: 'response.created', response: { id, model: 'gpt-r', status: 'in_progress' } },
        { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: textOut },
        {
          type: 'response.completed',
          response: {
            id,
            model: 'gpt-r',
            status: 'completed',
            output: [{ type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: textOut }] }],
            usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
          },
        },
      ],
      { done: false, events: true },
    );

  function responsesModel(fetch: unknown) {
    const provider = new OpenAIProvider({
      config,
      providerId: 'p1',
      http: fetch,
      settings: { providerType: 'openai-responses', apiKey: 'k', baseUrl: 'https://api.openai.com' },
    });
    return createModel({ provider, model: 'gpt-r', config });
  }

  test('surfaces an error delivered after the stream starts as a failed model call', async () => {
    const { fetch } = recordedFetch({ body: sse([
      { type: 'response.created', response: { id: 'resp_failed', model: 'gpt-r' } },
      { type: 'error', error: { code: 'credit_balance_exhausted', message: 'No credits remaining' } },
      { type: 'response.failed', response: { error: { message: 'No credits remaining' } } },
    ], { events: true, done: false }) });
    const model = responsesModel(fetch);
    const failure = await collect(model.stream(request('gpt-r', [user('hello')]), new AbortController().signal))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ModelFailure);
    expect(failure).toMatchObject({ message: 'No credits remaining', retryable: false });
  });

  test('continues from previous_response_id and reports the new one', async () => {
    const { fetch, calls } = recordedFetch({ body: responsesStream('resp_2', 'Hi again') });
    const model = responsesModel(fetch);
    expect(model.capabilities.continuity).toBe(true);

    const events = await collect(
      model.stream(request('gpt-r', [user('hello')], { previousResponseId: 'resp_1' }), new AbortController().signal),
    );

    expect(calls[0]!.url).toContain('/v1/responses');
    expect(calls[0]!.body.previous_response_id).toBe('resp_1');
    expect(text(events)).toBe('Hi again');
    expect(done(events)).toMatchObject({ stopReason: 'end_turn', continuation: 'resp_2' });
  });

  test('retries self-contained when the provider rejects the continuation', async () => {
    const { fetch, calls } = recordedFetch(
      {
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { param: 'previous_response_id', code: 'invalid_value', message: 'gone' } }),
      },
      { body: responsesStream('resp_3', 'Fresh') },
    );
    const model = responsesModel(fetch);

    const events = await collect(
      model.stream(request('gpt-r', [user('hello')], { previousResponseId: 'resp_old' }), new AbortController().signal),
    );

    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.previous_response_id).toBeUndefined();
    expect(text(events)).toBe('Fresh');
  });

  // A previous turn's reply, then the new message.
  const priorTurn = (): Item[] => [
    user('first question'),
    { type: 'assistant_message', id: 'a1' as ItemId, content: [{ type: 'text', text: 'first answer' }] },
    { type: 'user_message', id: 'u2' as ItemId, content: [{ type: 'text', text: 'second question' }] },
  ];
  const inputTexts = (body: Record<string, unknown>) => JSON.stringify(body.input);

  test('resumeFrom: the first request sends only the new message, chained to the stored response', async () => {
    const { fetch, calls } = recordedFetch({ body: responsesStream('resp_new', 'Second') }, { body: responsesStream('resp_more', 'Again') });
    const provider = new OpenAIProvider({
      config,
      providerId: 'p1',
      http: fetch,
      settings: { providerType: 'openai-responses', apiKey: 'k', baseUrl: 'https://api.openai.com' },
    });
    const model = createModel({ provider, model: 'gpt-r', config, resumeFrom: 'resp_prev' });

    const events = await collect(model.stream(request('gpt-r', priorTurn()), new AbortController().signal));

    expect(calls[0]!.body.previous_response_id).toBe('resp_prev');
    expect(inputTexts(calls[0]!.body)).toContain('second question');
    expect(inputTexts(calls[0]!.body)).not.toContain('first question');
    expect(inputTexts(calls[0]!.body)).not.toContain('first answer');
    expect(text(events)).toBe('Second');

    // Used once: a later request of the same turn doesn't reuse it.
    await collect(model.stream(request('gpt-r', priorTurn()), new AbortController().signal));
    expect(calls[1]!.body.previous_response_id).toBeUndefined();
    expect(inputTexts(calls[1]!.body)).toContain('first question');
  });

  test('resumeFrom: an unknown stored response retries with the full history', async () => {
    const { fetch, calls } = recordedFetch(
      {
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            type: 'invalid_request_error',
            param: 'previous_response_id',
            code: 'previous_response_not_found',
            message: "Previous response with id 'resp_prev' not found.",
          },
        }),
      },
      { body: responsesStream('resp_full', 'Recovered') },
    );
    const provider = new OpenAIProvider({
      config,
      providerId: 'p1',
      http: fetch,
      settings: { providerType: 'openai-responses', apiKey: 'k', baseUrl: 'https://api.openai.com' },
    });
    const model = createModel({ provider, model: 'gpt-r', config, resumeFrom: 'resp_prev' });

    const events = await collect(model.stream(request('gpt-r', priorTurn()), new AbortController().signal));

    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.previous_response_id).toBeUndefined();
    for (const said of ['first question', 'first answer', 'second question']) expect(inputTexts(calls[1]!.body)).toContain(said);
    expect(text(events)).toBe('Recovered');
  });

  test('resumeFrom is ignored where continuation is not supported (Chat Completions)', async () => {
    const { fetch, calls } = recordedFetch({ body: sse([{ id: 'c', choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]) });
    const provider = new OpenAIProvider({
      config,
      providerId: 'p1',
      http: fetch,
      settings: { providerType: 'openai-completions', apiKey: 'k', baseUrl: 'https://api.example.test' },
    });
    const model = createModel({ provider, model: 'gpt-x', config, resumeFrom: 'resp_prev' });

    await collect(model.stream(request('gpt-x', priorTurn()), new AbortController().signal));

    expect(calls[0]!.body.previous_response_id).toBeUndefined();
    expect(JSON.stringify(calls[0]!.body.messages)).toContain('first question');
  });

  test('OpenRouter Responses does not continue from previous_response_id', async () => {
    const { fetch, calls } = recordedFetch({ body: responsesStream('resp_2', 'Hi again') });
    const provider = new OpenAIProvider({
      config,
      providerId: 'openrouter',
      http: fetch,
      settings: { providerType: 'openai-responses', apiKey: 'k', baseUrl: 'https://openrouter.ai/api/v1' },
    });
    const model = createModel({ provider, model: 'openai/gpt-6-astra', config, resumeFrom: 'resp_prev' });
    expect(model.capabilities.continuity).toBe(false);

    await collect(
      model.stream(
        request('openai/gpt-6-astra', priorTurn(), { previousResponseId: 'resp_1' }),
        new AbortController().signal,
      ),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('https://openrouter.ai/api/v1/responses');
    expect(calls[0]!.body.previous_response_id).toBeUndefined();
    for (const said of ['first question', 'first answer', 'second question']) {
      expect(inputTexts(calls[0]!.body)).toContain(said);
    }
  });

  test('OpenRouter tool follow-up sends full history and no previous_response_id', async () => {
    const { fetch, calls } = recordedFetch({ body: responsesStream('resp_2', '18C and sunny') });
    const provider = new OpenAIProvider({
      config,
      providerId: 'openrouter',
      http: fetch,
      settings: { providerType: 'openai-responses', apiKey: 'k', baseUrl: 'https://openrouter.ai/api/v1' },
    });
    const model = createModel({ provider, model: 'openai/gpt-6-astra', config });
    const history: Item[] = [
      user('Weather in Paris?'),
      {
        type: 'tool_call',
        id: 't1' as ItemId,
        callId: 'call_weather_1' as ToolCallId,
        toolName: 'web_search',
        input: { query: 'paris weather' },
        rawArguments: '{"query":"paris weather"}',
      },
      {
        type: 'tool_result',
        id: 'r1' as ItemId,
        callId: 'call_weather_1' as ToolCallId,
        output: '18C and sunny',
        isError: false,
      },
    ];

    await collect(
      model.stream(
        request('openai/gpt-6-astra', history, { previousResponseId: 'resp_turn1', reasoning: 'none' }),
        new AbortController().signal,
      ),
    );

    expect(calls[0]!.body.previous_response_id).toBeUndefined();
    expect(calls[0]!.body.reasoning).toEqual({ effort: 'low', summary: 'auto' });
    const inputTypes = (calls[0]!.body.input as Array<{ type?: string; role?: string }>).map(
      (item) => item.type ?? item.role,
    );
    expect(inputTypes).toEqual(['system', 'user', 'function_call', 'function_call_output']);
    expect(JSON.stringify(calls[0]!.body.input)).toContain('call_weather_1');
    expect(JSON.stringify(calls[0]!.body.input)).toContain('18C and sunny');
  });
});

describe('AnthropicModel', () => {
  const frames = [
    { type: 'message_start', message: { id: 'msg_1', model: 'claude-x', usage: { input_tokens: 30, output_tokens: 1, cache_read_input_tokens: 25 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'User wants weather.' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-abc' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Checking.' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'web_search', input: {} } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"query":' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"weather"}' } },
    { type: 'content_block_stop', index: 2 },
    // message_delta usage is cumulative, input and cache counts included.
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use' },
      usage: { input_tokens: 30, cache_read_input_tokens: 25, output_tokens: 15 },
    },
    { type: 'message_stop' },
  ];

  test('maps thinking, text and tool_use, and places cache breakpoints', async () => {
    const { fetch, calls } = recordedFetch({ body: sse(frames, { done: false, events: true }) });
    const provider = new AnthropicProvider({
      config,
      providerId: 'p1',
      http: fetch,
      settings: { providerType: 'anthropic', apiKey: 'k' },
    });
    const model = createModel({ provider, model: 'claude-x', config });
    expect(model).toBeInstanceOf(AnthropicModel);

    const events = await collect(model.stream(request('claude-x', [user('Weather?')]), new AbortController().signal));

    // Cache breakpoints reach the Messages API request.
    expect(JSON.stringify(calls[0]!.body)).toContain('"cache_control":{"type":"ephemeral"}');
    expect(calls[0]!.url).toContain('/v1/messages');

    expect(reasoning(events)).toBe('User wants weather.');
    expect(text(events)).toBe('Checking.');
    const out = items(events);
    expect(out.map((item) => item.type)).toEqual(['reasoning', 'assistant_message', 'tool_call']);
    expect(out[2]).toMatchObject({ callId: 'toolu_1', toolName: 'web_search', input: { query: 'weather' } });
    expect(done(events).stopReason).toBe('tool_use');
    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toMatchObject({ usage: { inputTokens: 30, outputTokens: 15, cachedInputTokens: 25 } });
  });
});

describe('GeminiModel', () => {
  const frames = [
    { candidates: [{ content: { role: 'model', parts: [{ text: 'Thinking it over', thought: true }] } }] },
    { candidates: [{ content: { role: 'model', parts: [{ text: 'Let me look.' }] } }] },
    {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ functionCall: { name: 'web_search', args: { query: 'gemini' } }, thoughtSignature: 'ts-1' }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 6, totalTokenCount: 17 },
    },
  ];

  test('maps thoughts, text and a function call with its thought signature', async () => {
    const { fetch, calls } = recordedFetch({ body: sse(frames, { done: false }) });
    const provider = new GeminiProvider({
      config,
      providerId: 'p1',
      http: fetch,
      settings: { providerType: 'gemini', apiKey: 'k' },
    });
    const model = createModel({ provider, model: 'gemini-x', config });
    expect(model).toBeInstanceOf(GeminiModel);

    const events = await collect(model.stream(request('gemini-x', [user('Search')]), new AbortController().signal));

    expect(calls[0]!.url).toContain('streamGenerateContent');
    expect(reasoning(events)).toBe('Thinking it over');
    expect(text(events)).toBe('Let me look.');
    const call = items(events).find((item) => item.type === 'tool_call');
    expect(call).toMatchObject({
      toolName: 'web_search',
      input: { query: 'gemini' },
      providerMetadata: { gemini_thought_signature: 'ts-1' },
    });
    expect(done(events).stopReason).toBe('tool_use');
    expect(events.find((e) => e.type === 'usage')).toMatchObject({ usage: { inputTokens: 11, outputTokens: 6 } });
  });

  test('sends the thought signature back on replay', async () => {
    const { fetch, calls } = recordedFetch({
      body: sse([{ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }], {
        done: false,
      }),
    });
    const provider = new GeminiProvider({
      config,
      providerId: 'p1',
      http: fetch,
      settings: { providerType: 'gemini', apiKey: 'k' },
    });
    const model = createModel({ provider, model: 'gemini-x', config });
    const history: Item[] = [
      user('Search'),
      {
        type: 'tool_call',
        id: 't1' as ItemId,
        callId: 'call_g' as ToolCallId,
        toolName: 'web_search',
        input: { query: 'gemini' },
        providerMetadata: { gemini_thought_signature: 'ts-1' },
      },
      { type: 'tool_result', id: 'r1' as ItemId, callId: 'call_g' as ToolCallId, output: 'results', isError: false },
    ];

    await collect(model.stream(request('gemini-x', history), new AbortController().signal));
    expect(JSON.stringify(calls[0]!.body)).toContain('"thoughtSignature":"ts-1"');
  });
});

describe('LlamaCppModel', () => {
  test('maps reasoning_content and timings-based usage', async () => {
    const { fetch } = recordedFetch({
      body: sse([
        { id: 'chatcmpl-l', choices: [{ index: 0, delta: { reasoning_content: 'hmm' } }] },
        { id: 'chatcmpl-l', choices: [{ index: 0, delta: { content: 'Answer' } }] },
        {
          id: 'chatcmpl-l',
          choices: [{ index: 0, delta: {}, finish_reason: 'length' }],
          timings: { prompt_n: 7, predicted_n: 3, predicted_ms: 40 },
        },
      ]),
    });
    const provider = new LlamaCppProvider({
      config,
      providerId: 'p1',
      http: fetch,
      settings: { providerType: 'llama-cpp', baseUrl: 'http://localhost:8080' },
    });
    const model = createModel({ provider, model: 'local', config });
    expect(model).toBeInstanceOf(LlamaCppModel);
    expect(model.capabilities.continuity).toBe(false);

    const events = await collect(model.stream(request('local', [user('q')]), new AbortController().signal));

    expect(reasoning(events)).toBe('hmm');
    expect(text(events)).toBe('Answer');
    expect(done(events).stopReason).toBe('max_tokens');
    expect(events.find((e) => e.type === 'usage')).toMatchObject({ usage: { inputTokens: 7, outputTokens: 3 } });
  });
});

describe('createModelRegistry', () => {
  test('resolves each model by its ref, independently', () => {
    const make = (id: string) =>
      createModel({
        provider: new OpenAIProvider({ config, providerId: id, settings: { providerType: 'openai-completions' } }),
        model: 'm',
        config,
      });
    const a = make('a');
    const b = make('b');
    const registry = createModelRegistry([a, b]);
    expect(registry.resolve({ provider: 'a', model: 'm' })).toBe(a);
    expect(registry.resolve({ provider: 'b', model: 'm' })).toBe(b);
    expect(registry.list()).toEqual([a.ref, b.ref]);
    expect(() => registry.resolve({ provider: 'c', model: 'm' })).toThrow(/No model registered/);
  });
});
