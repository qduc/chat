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
    test('normalizes messages and strips reserved keys', () => {
      const adapter = createAdapter();
      const result = adapter.translateRequest({
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

    test('uses default model from context when not provided', () => {
      const adapter = createAdapter();
      const result = adapter.translateRequest({
        messages: [{ role: 'user', content: 'hi' }],
      }, {
        getDefaultModel: () => 'context-model',
      });

      expect(result.model).toBe('context-model');
    });

    test('throws when messages are missing', () => {
      const adapter = createAdapter();
      expect(() => adapter.translateRequest({})).toThrow('requires at least one message');
    });

    test('expands string tool definitions', () => {
      const adapter = createAdapter();
      const result = adapter.translateRequest({
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

    test('passes through reasoning controls from frontend', () => {
      const adapter = createAdapter();
      const result = adapter.translateRequest({
        messages: [{ role: 'user', content: 'hi' }],
        reasoning_effort: 'medium',
        verbosity: 'high',
      });

      expect(result.reasoning).toEqual({ effort: 'medium' });
      expect(result.verbosity).toBe('high');
    });

    test('handles reasoning controls for any model', () => {
      const adapter = createAdapter();
      const result = adapter.translateRequest({
        model: 'gpt-5.1-mini',
        messages: [{ role: 'user', content: 'hi' }],
        reasoning_effort: 'medium',
        verbosity: 'high',
      });

      expect(result.reasoning).toEqual({ effort: 'medium' });
      expect(result.verbosity).toBe('high');
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
