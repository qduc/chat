import { PassThrough } from 'node:stream';
import { ResponsesAPIAdapter } from '../src/lib/adapters/responsesApiAdapter.js';

function createHeaderShim(entries = {}) {
  const store = new Map();
  for (const [key, value] of Object.entries(entries)) {
    if (value == null) continue;
    store.set(String(key).toLowerCase(), String(value));
  }
  return {
    get(name) {
      if (!name) return null;
      return store.get(String(name).toLowerCase()) || null;
    },
    entries() {
      return Array.from(store.entries());
    },
  };
}

function createAdapter(overrides = {}) {
  return new ResponsesAPIAdapter({
    getDefaultModel: () => 'gpt-default',
    supportsReasoningControls: () => false,
    ...overrides,
  });
}

class MockJsonResponse {
  constructor(json, { headers = { 'content-type': 'application/json' }, ok = true, status = 200 } = {}) {
    this._json = json;
    this.ok = ok;
    this.status = status;
    this.headers = createHeaderShim(headers);
  }

  async json() {
    return this._json;
  }

  clone() {
    const entries = Object.fromEntries(this.headers.entries());
    return new MockJsonResponse(this._json, { headers: entries, ok: this.ok, status: this.status });
  }
}

class MockStreamResponse {
  constructor() {
    this.ok = true;
    this.status = 200;
    this.headers = createHeaderShim({ 'content-type': 'text/event-stream' });
    this.body = new PassThrough();
  }

  clone() {
    return new MockStreamResponse();
  }
}

describe('ResponsesAPIAdapter', () => {
  describe('translateRequest', () => {
    test('maps chat-style payload into responses format', () => {
      const adapter = createAdapter();
      const request = adapter.translateRequest({
        messages: [
          { role: 'system', content: 'Be helpful' },
          { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
          {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_42',
                type: 'function',
                function: { name: 'lookup', arguments: { query: 'answer' } },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'call_42', content: '42' },
        ],
        tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {} } } }],
        tool_choice: { type: 'function', function: { name: 'lookup' } },
        previous_response_id: 'resp_prev',
        stream: true,
        max_tokens: 128,
      });

      expect(request.model).toBe('gpt-default');
      expect(request.input).toHaveLength(4);
      expect(request.input[0]).toMatchObject({ role: 'system', content: [{ type: 'input_text', text: 'Be helpful' }] });
      expect(request.input[1]).toMatchObject({ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] });
      expect(request.input[2]).toEqual({
        type: 'function_call',
        call_id: 'call_42',
        name: 'lookup',
        arguments: '{"query":"answer"}',
      });
      expect(request.input[3]).toEqual({
        type: 'function_call_output',
        call_id: 'call_42',
        output: '42',
      });
      expect(request.tools).toEqual([
        {
          type: 'function',
          name: 'lookup',
          parameters: { type: 'object', properties: {} },
        },
      ]);
      expect(request.tool_choice).toEqual({ type: 'function', name: 'lookup' });
      expect(request.max_output_tokens).toBe(128);
      expect(request.previous_response_id).toBe('resp_prev');
      expect(request.stream).toBe(true);
      expect(Object.keys(request)).not.toContain('__endpoint');
      expect(request.__endpoint).toBe('/v1/responses');
    });

    test('falls back to default model and enforces message requirement', () => {
      const adapter = createAdapter({ getDefaultModel: () => 'gpt-fallback' });

      expect(() => adapter.translateRequest({})).toThrow('requires at least one message');

      const request = adapter.translateRequest({
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(request.model).toBe('gpt-fallback');
      expect(request.input[0].content[0]).toEqual({ type: 'input_text', text: 'hi' });
    });

    test('prioritizes call_id over id when both are present', () => {
      const adapter = createAdapter();
      const request = adapter.translateRequest({
        messages: [
          { role: 'user', content: 'Search for something' },
          {
            role: 'assistant',
            tool_calls: [
              {
                id: 'fc_internal_id_12345',
                call_id: 'call_actual_reference_67890',
                type: 'function',
                function: { name: 'web_search', arguments: { query: 'test' } },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'call_actual_reference_67890', content: 'Search results' },
        ],
        tools: [{ type: 'function', function: { name: 'web_search', parameters: { type: 'object', properties: {} } } }],
      });

      // The function_call should use call_id, not id
      expect(request.input[1]).toEqual({
        type: 'function_call',
        call_id: 'call_actual_reference_67890',
        name: 'web_search',
        arguments: '{"query":"test"}',
      });

      // The function_call_output should match the same call_id
      expect(request.input[2]).toEqual({
        type: 'function_call_output',
        call_id: 'call_actual_reference_67890',
        output: 'Search results',
      });
    });
  });

  describe('translateResponse', () => {
    test('rewrites JSON payloads into chat completion shape', async () => {
      const adapter = createAdapter();
      const raw = {
        id: 'resp_123',
        status: 'completed',
        model: 'gpt-4.1-mini',
        created_at: 123,
        output: [{ content: [{ type: 'output_text', text: 'Hello world' }] }],
        usage: { input_tokens: 3, output_tokens: 5 },
      };

      const wrapped = adapter.translateResponse(new MockJsonResponse(raw));
      const mapped = await wrapped.json();

      expect(mapped.object).toBe('chat.completion');
      expect(mapped.id).toBe('resp_123');
      expect(mapped.model).toBe('gpt-4.1-mini');
      expect(mapped.choices[0].message).toEqual({ role: 'assistant', content: 'Hello world' });
      expect(mapped.choices[0].finish_reason).toBe('stop');
      expect(mapped.usage).toEqual({ prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 });
    });

    test('transforms streaming responses into chat completion chunks', async () => {
      const adapter = createAdapter();
      const upstream = new MockStreamResponse();
      const transformed = adapter.translateResponse(upstream);

      const received = [];
      await new Promise((resolve, reject) => {
        transformed.body.on('data', (chunk) => received.push(chunk.toString()));
        transformed.body.on('end', resolve);
        transformed.body.on('error', reject);

        upstream.body.write('data: {"type":"response.output_text.delta","delta":"Hello"}\n\n');
        upstream.body.write('data: {"type":"response.output_text.delta","delta":" world"}\n\n');
        upstream.body.write('data: {"type":"response.completed","response":{"id":"resp_stream","model":"gpt-4.1-mini","usage":{"input_tokens":2,"output_tokens":4}}}\n\n');
        upstream.body.write('data: [DONE]\n\n');
        upstream.body.end();
      });

      const combined = received.join('');
      const parts = combined
        .split('\n\n')
        .filter(Boolean)
        .map((segment) => segment.replace(/^data:\s*/, ''));

      const jsonChunks = parts
        .filter((segment) => segment !== '[DONE]')
        .map((segment) => JSON.parse(segment));

      expect(parts[parts.length - 1]).toBe('[DONE]');
      expect(jsonChunks[0].choices[0].delta.role).toBe('assistant');
      expect(jsonChunks.some((chunk) => chunk.choices[0].delta.content === 'Hello')).toBe(true);
      expect(jsonChunks.some((chunk) => chunk.choices[0].delta.content === ' world')).toBe(true);

      const finalChunk = jsonChunks.find((chunk) => chunk.choices[0].finish_reason === 'stop');
      expect(finalChunk).toBeDefined();
      expect(finalChunk.usage).toEqual({ prompt_tokens: 2, completion_tokens: 4, total_tokens: 6 });
    });
  });

  describe('translateStreamChunk', () => {
    test('parses JSON and forwards [DONE]', () => {
      const adapter = createAdapter();
      expect(adapter.translateStreamChunk(' {"foo":1} ')).toEqual({ foo: 1 });
      expect(adapter.translateStreamChunk(' [DONE] ')).toBe('[DONE]');
      expect(adapter.translateStreamChunk('')).toBeNull();
      expect(adapter.translateStreamChunk('invalid')).toBeNull();
    });
  });
});
