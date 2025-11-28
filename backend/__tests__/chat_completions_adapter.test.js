import { ChatCompletionsAdapter } from '../src/lib/adapters/chatCompletionsAdapter.js';

function createAdapter(overrides = {}) {
  return new ChatCompletionsAdapter({
    getDefaultModel: () => 'fallback-model',
    supportsReasoningControls: () => false,
    ...overrides,
  });
}

describe('ChatCompletionsAdapter', () => {
  describe('translateRequest', () => {
    test('normalizes messages and strips reserved keys', async () => {
      const adapter = createAdapter();
      const result = await adapter.translateRequest({
        conversation_id: 'conv-123',
        provider_id: 'openai',
        model: 'gpt-custom',
        messages: [
          { role: 'user', content: 42 },
          { role: 'assistant', content: ['chunk-1'] },
        ],
        temperature: 0.5,
        tool_choice: 'auto',
        tools: [{ type: 'function', function: { name: 'echo', parameters: { type: 'object' } } }],
      });

      expect(result).toEqual({
        model: 'gpt-custom',
        messages: [
          { role: 'user', content: '42' },
          { role: 'assistant', content: ['chunk-1'] },
        ],
        temperature: 0.5,
        tool_choice: 'auto',
        tools: [{ type: 'function', function: { name: 'echo', parameters: { type: 'object' } } }],
      });
      expect(result.conversation_id).toBeUndefined();
      expect(result.provider_id).toBeUndefined();
    });

    test('uses default model from context when not provided', async () => {
      const adapter = createAdapter();
      const result = await adapter.translateRequest(
        {
          messages: [{ role: 'user', content: 'hi' }],
        },
        {
          getDefaultModel: () => 'context-model',
        }
      );

      expect(result.model).toBe('context-model');
    });

    test('throws when messages are missing', async () => {
      const adapter = createAdapter();
      await expect(adapter.translateRequest({})).rejects.toThrow('requires at least one message');
    });

    test('expands string tool definitions', async () => {
      const adapter = createAdapter();
      const result = await adapter.translateRequest({
        messages: [{ role: 'user', content: 'call tool' }],
        tools: ['get_weather'],
      });

      expect(result.tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: '',
            parameters: { type: 'object', properties: {} },
          },
        },
      ]);
    });

    test('passes through reasoning controls from frontend', async () => {
      const adapter = createAdapter();
      const result = await adapter.translateRequest({
        messages: [{ role: 'user', content: 'hi' }],
        reasoning_effort: 'medium',
        verbosity: 'high',
      });

      expect(result.reasoning).toEqual({ effort: 'medium' });
      expect(result.verbosity).toBe('high');
    });

    test('handles reasoning controls for any model', async () => {
      const adapter = createAdapter();
      const result = await adapter.translateRequest({
        model: 'gpt-5.1-mini',
        messages: [{ role: 'user', content: 'hi' }],
        reasoning_effort: 'medium',
        verbosity: 'high',
      });

      expect(result.reasoning).toEqual({ effort: 'medium' });
      expect(result.verbosity).toBe('high');
    });

    test('uses nested reasoning format by default', async () => {
      const adapter = createAdapter();
      const result = await adapter.translateRequest({
        messages: [{ role: 'user', content: 'hi' }],
        reasoning_effort: 'high',
      });

      expect(result.reasoning).toEqual({ effort: 'high' });
      expect(result.reasoning_effort).toBeUndefined();
    });

    test('uses flat reasoning format when configured', async () => {
      const adapter = createAdapter({ reasoningFormat: 'flat' });
      const result = await adapter.translateRequest({
        messages: [{ role: 'user', content: 'hi' }],
        reasoning_effort: 'low',
      });

      expect(result.reasoning_effort).toBe('low');
      expect(result.reasoning).toBeUndefined();
    });

    test('omits reasoning fields when format is none', async () => {
      const adapter = createAdapter({ reasoningFormat: 'none' });
      const result = await adapter.translateRequest({
        messages: [{ role: 'user', content: 'hi' }],
        reasoning_effort: 'medium',
      });

      expect(result.reasoning).toBeUndefined();
      expect(result.reasoning_effort).toBeUndefined();
    });

    test('context reasoningFormat overrides adapter default', async () => {
      const adapter = createAdapter({ reasoningFormat: 'nested' });
      const result = await adapter.translateRequest(
        {
          messages: [{ role: 'user', content: 'hi' }],
          reasoning_effort: 'high',
        },
        { reasoningFormat: 'flat' }
      );

      expect(result.reasoning_effort).toBe('high');
      expect(result.reasoning).toBeUndefined();
    });

    test('accepts nested reasoning object from input', async () => {
      const adapter = createAdapter();
      const result = await adapter.translateRequest({
        messages: [{ role: 'user', content: 'hi' }],
        reasoning: { effort: 'medium' },
      });

      expect(result.reasoning).toEqual({ effort: 'medium' });
    });

    test('prefers reasoning_effort over reasoning.effort when both provided', async () => {
      const adapter = createAdapter();
      const result = await adapter.translateRequest({
        messages: [{ role: 'user', content: 'hi' }],
        reasoning_effort: 'high',
        reasoning: { effort: 'low' },
      });

      expect(result.reasoning).toEqual({ effort: 'high' });
    });
  });

  describe('translateResponse', () => {
    test('parses JSON strings and returns plain values otherwise', () => {
      const adapter = createAdapter();
      expect(adapter.translateResponse('{"foo":1}')).toEqual({ foo: 1 });
      expect(adapter.translateResponse('not-json')).toBe('not-json');
    });
  });

  describe('translateStreamChunk', () => {
    test('parses JSON, preserves [DONE], and ignores invalid chunks', () => {
      const adapter = createAdapter();
      expect(adapter.translateStreamChunk('{"delta":"hi"}')).toEqual({ delta: 'hi' });
      expect(adapter.translateStreamChunk(' [DONE]\n')).toBe('[DONE]');
      expect(adapter.translateStreamChunk('')).toBeNull();
      expect(adapter.translateStreamChunk('invalid-json')).toBeNull();
    });

    test('returns non-string chunks as-is', () => {
      const adapter = createAdapter();
      const chunk = { raw: true };
      expect(adapter.translateStreamChunk(chunk)).toBe(chunk);
    });
  });
});
