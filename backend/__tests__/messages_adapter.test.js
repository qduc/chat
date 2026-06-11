import { describe, test, expect } from '@jest/globals';
import { MessagesAdapter } from '../src/lib/adapters/messagesAdapter.js';

describe('MessagesAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new MessagesAdapter({
      config: {},
      settings: {},
      getDefaultModel: () => 'claude-3-5-sonnet-20241022',
    });
  });

  describe('translateRequest', () => {
    test('converts OpenAI format to Anthropic format', async () => {
      const internalRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello!' },
        ],
        max_tokens: 1000,
      };

      const result = await adapter.translateRequest(internalRequest);

      expect(result.model).toBe('claude-3-5-sonnet-20241022');
      expect(result.system).toBe('You are a helpful assistant.');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({ role: 'user', content: 'Hello!' });
      expect(result.max_tokens).toBe(1000);
    });

    test('handles multiple system messages', async () => {
      const internalRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'system', content: 'First instruction.' },
          { role: 'system', content: 'Second instruction.' },
          { role: 'user', content: 'Hello!' },
        ],
      };

      const result = await adapter.translateRequest(internalRequest);

      expect(result.system).toBe('First instruction.\n\nSecond instruction.');
      expect(result.messages).toHaveLength(1);
    });

    test('converts tool specifications', async () => {
      const internalRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Use a tool' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather',
              parameters: {
                type: 'object',
                properties: { location: { type: 'string' } },
              },
            },
          },
        ],
      };

      const result = await adapter.translateRequest(internalRequest);

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]).toEqual({
        name: 'get_weather',
        description: 'Get weather',
        input_schema: {
          type: 'object',
          properties: { location: { type: 'string' } },
        },
      });
    });

    test('converts assistant messages with tool calls', async () => {
      const internalRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'user', content: 'What is the weather?' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location":"San Francisco"}',
                },
              },
            ],
          },
        ],
      };

      const result = await adapter.translateRequest(internalRequest);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[1].content).toEqual([
        {
          type: 'tool_use',
          id: 'call_123',
          name: 'get_weather',
          input: { location: 'San Francisco' },
        },
      ]);
    });

    test('converts tool results from OpenAI format', async () => {
      const internalRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'user', content: 'What is the weather?' },
          {
            role: 'tool',
            tool_call_id: 'call_123',
            content: 'Sunny, 72°F',
          },
        ],
      };

      const result = await adapter.translateRequest(internalRequest);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toEqual([
        {
          type: 'tool_result',
          tool_use_id: 'call_123',
          content: 'Sunny, 72°F',
        },
      ]);
    });

    test('sets default max_tokens if not provided', async () => {
      const internalRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello!' }],
      };

      const result = await adapter.translateRequest(internalRequest);

      expect(result.max_tokens).toBe(64000);
    });

    test('uses default model if not specified', async () => {
      const internalRequest = {
        messages: [{ role: 'user', content: 'Hello!' }],
      };

      const result = await adapter.translateRequest(internalRequest);

      expect(result.model).toBe('claude-3-5-sonnet-20241022');
    });

    test('throws error if no model and no default', async () => {
      const adapterNoDefault = new MessagesAdapter({
        config: {},
        settings: {},
        getDefaultModel: () => undefined,
      });

      const internalRequest = {
        messages: [{ role: 'user', content: 'Hello!' }],
      };

      await expect(adapterNoDefault.translateRequest(internalRequest)).rejects.toThrow(
        'Anthropic provider requires a model'
      );
    });

    test('throws error if no non-system messages', async () => {
      const internalRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'system', content: 'System only' }],
      };

      await expect(adapter.translateRequest(internalRequest)).rejects.toThrow(
        'Anthropic provider requires at least one non-system message'
      );
    });

    describe('reasoning controls', () => {
      const baseRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'hi' }],
      };

      function anthropicAdapter() {
        return new MessagesAdapter({
          config: {},
          settings: {},
          getDefaultModel: () => 'claude-3-5-sonnet-20241022',
          reasoningFormat: 'anthropic',
        });
      }

      test('omits thinking/output_config when reasoning_effort is missing', async () => {
        const result = await anthropicAdapter().translateRequest(baseRequest);
        expect(result.thinking).toBeUndefined();
        expect(result.output_config).toBeUndefined();
      });

      test('disables thinking for none', async () => {
        const result = await anthropicAdapter().translateRequest({
          ...baseRequest,
          reasoning_effort: 'none',
        });
        expect(result.thinking).toEqual({ type: 'disabled' });
        expect(result.output_config).toBeUndefined();
      });

      test('disables thinking for minimal', async () => {
        const result = await anthropicAdapter().translateRequest({
          ...baseRequest,
          reasoning_effort: 'minimal',
        });
        expect(result.thinking).toEqual({ type: 'disabled' });
        expect(result.output_config).toBeUndefined();
      });

      test.each([
        ['low', 'low'],
        ['medium', 'medium'],
        ['high', 'high'],
        ['xhigh', 'xhigh'],
        ['max', 'max'],
      ])('maps %s to adaptive thinking + output_config.effort=%s', async (input, expected) => {
        const result = await anthropicAdapter().translateRequest({
          ...baseRequest,
          reasoning_effort: input,
        });
        expect(result.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
        expect(result.output_config).toEqual({ effort: expected });
      });

      test('does not place effort inside thinking (per API requirement)', async () => {
        const result = await anthropicAdapter().translateRequest({
          ...baseRequest,
          reasoning_effort: 'high',
        });
        expect(result.thinking.effort).toBeUndefined();
        expect(result.thinking.budget_tokens).toBeUndefined();
      });

      test('accepts nested reasoning.effort input', async () => {
        const result = await anthropicAdapter().translateRequest({
          ...baseRequest,
          reasoning: { effort: 'medium' },
        });
        expect(result.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
        expect(result.output_config).toEqual({ effort: 'medium' });
      });

      test('prefers reasoning_effort over reasoning.effort when both provided', async () => {
        const result = await anthropicAdapter().translateRequest({
          ...baseRequest,
          reasoning_effort: 'high',
          reasoning: { effort: 'low' },
        });
        expect(result.output_config).toEqual({ effort: 'high' });
      });

      test('lets custom_request_params override reasoning-derived output_config', async () => {
        const result = await anthropicAdapter().translateRequest({
          ...baseRequest,
          reasoning_effort: 'medium',
          custom_request_params: { output_config: { effort: 'max', format: { type: 'json' } } },
        });
        // applyCustomRequestParams runs after reasoning controls and wins.
        expect(result.output_config).toEqual({
          effort: 'max',
          format: { type: 'json' },
        });
        // thinking is not in CUSTOM_REQUEST_PARAMS_BLOCKLIST, so it can also
        // be overridden via custom_request_params when callers need manual
        // extended thinking instead of adaptive.
        expect(result.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      });

      test('lets custom_request_params override display: summarized', async () => {
        const result = await anthropicAdapter().translateRequest({
          ...baseRequest,
          reasoning_effort: 'high',
          custom_request_params: { thinking: { type: 'adaptive', display: 'full' } },
        });
        // custom_request_params wins (applied after reasoning controls).
        expect(result.thinking).toEqual({ type: 'adaptive', display: 'full' });
      });

      test('omits display on disabled thinking', async () => {
        const result = await anthropicAdapter().translateRequest({
          ...baseRequest,
          reasoning_effort: 'none',
        });
        // display only applies to thinking that produces content.
        expect(result.thinking).toEqual({ type: 'disabled' });
      });

      test('omits thinking/output_config when reasoningFormat is none (default)', async () => {
        const defaultAdapter = new MessagesAdapter({
          config: {},
          settings: {},
          getDefaultModel: () => 'claude-3-5-sonnet-20241022',
        });
        const result = await defaultAdapter.translateRequest({
          ...baseRequest,
          reasoning_effort: 'high',
        });
        expect(result.thinking).toBeUndefined();
        expect(result.output_config).toBeUndefined();
      });

      test('context reasoningFormat overrides adapter default', async () => {
        const defaultAdapter = new MessagesAdapter({
          config: {},
          settings: {},
          getDefaultModel: () => 'claude-3-5-sonnet-20241022',
        });
        const result = await defaultAdapter.translateRequest(
          { ...baseRequest, reasoning_effort: 'low' },
          { reasoningFormat: 'anthropic' }
        );
        expect(result.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
        expect(result.output_config).toEqual({ effort: 'low' });
      });

      test('ignores unknown effort levels gracefully', async () => {
        const result = await anthropicAdapter().translateRequest({
          ...baseRequest,
          reasoning_effort: 'extreme',
        });
        expect(result.thinking).toBeUndefined();
        expect(result.output_config).toBeUndefined();
      });
    });
  });

  describe('translateResponse', () => {
    test('converts Anthropic response to OpenAI format', async () => {
      const anthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-5-sonnet-20241022',
        content: [{ type: 'text', text: 'Hello! How can I help?' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20 },
      };

      const result = await adapter.translateResponse(anthropicResponse);

      expect(result.id).toBe('msg_123');
      expect(result.object).toBe('chat.completion');
      expect(result.model).toBe('claude-3-5-sonnet-20241022');
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].message.role).toBe('assistant');
      expect(result.choices[0].message.content).toBe('Hello! How can I help?');
      expect(result.choices[0].finish_reason).toBe('stop');
      expect(result.usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      });
    });

    test('converts tool use in response', async () => {
      const anthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-5-sonnet-20241022',
        content: [
          { type: 'text', text: 'Let me check that.' },
          {
            type: 'tool_use',
            id: 'tool_123',
            name: 'get_weather',
            input: { location: 'San Francisco' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 20 },
      };

      const result = await adapter.translateResponse(anthropicResponse);

      expect(result.choices[0].message.content).toBe('Let me check that.');
      expect(result.choices[0].message.tool_calls).toHaveLength(1);
      expect(result.choices[0].message.tool_calls[0]).toEqual({
        id: 'tool_123',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"location":"San Francisco"}',
        },
        index: 1,
      });
    });
  });

  describe('translateStreamChunk', () => {
    test('converts message_start event', () => {
      const event = {
        type: 'message_start',
        message: {
          id: 'msg_123',
          model: 'claude-3-5-sonnet-20241022',
        },
      };

      const result = adapter.translateStreamChunk(event);

      expect(result.id).toBe('msg_123');
      expect(result.object).toBe('chat.completion.chunk');
      expect(result.model).toBe('claude-3-5-sonnet-20241022');
      expect(result.choices[0].delta.role).toBe('assistant');
      expect(result.choices[0].delta.content).toBe('');
    });

    test('converts content_block_delta with text', () => {
      const event = {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      };

      const result = adapter.translateStreamChunk(event);

      expect(result.choices[0].delta.content).toBe('Hello');
    });

    test('converts message_stop event', () => {
      const event = { type: 'message_stop' };

      const result = adapter.translateStreamChunk(event);

      expect(result).toBe('[DONE]');
    });

    test('returns null for ping events', () => {
      const event = { type: 'ping' };

      const result = adapter.translateStreamChunk(event);

      expect(result).toBeNull();
    });

    test('converts content_block_delta with thinking_delta to reasoning_content', () => {
      const event = {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'thinking_delta',
          thinking: ' user is asking whether 1+1 can equal something other than 2. ',
        },
      };

      const result = adapter.translateStreamChunk(event);

      expect(result).toBeTruthy();
      expect(result.object).toBe('chat.completion.chunk');
      // Surfaced to the UI via the field the frontend reads for streaming reasoning.
      expect(result.choices[0].delta.reasoning_content).toBe(
        ' user is asking whether 1+1 can equal something other than 2. '
      );
      // `delta.reasoning` is the fallback the streaming handler also checks.
      expect(result.choices[0].delta.reasoning).toBe(
        ' user is asking whether 1+1 can equal something other than 2. '
      );
      // No visible content is emitted for thinking deltas.
      expect(result.choices[0].delta.content).toBeUndefined();
    });

    test('emits thinking_delta as a separate stream chunk from text_delta', () => {
      // The user's reported example interleaves thinking_delta events with
      // the eventual text_delta for the same content_block index. Each
      // delta must produce its own OpenAI-shaped chunk.
      const thinkingEvent = {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Reasoning...' },
      };
      const textEvent = {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Answer.' },
      };

      const thinkingResult = adapter.translateStreamChunk(thinkingEvent);
      const textResult = adapter.translateStreamChunk(textEvent);

      expect(thinkingResult.choices[0].delta.reasoning_content).toBe('Reasoning...');
      expect(thinkingResult.choices[0].delta.content).toBeUndefined();
      expect(textResult.choices[0].delta.content).toBe('Answer.');
      expect(textResult.choices[0].delta.reasoning_content).toBeUndefined();
    });

    test('converts content_block_delta with signature_delta to reasoning_details', () => {
      // The signature is not rendered to the UI but must be carried through
      // the stream as a `reasoning_details` entry so it can be re-sent to
      // Anthropic on the next turn and preserve the prompt cache.
      const event = {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'Er4CCm...' },
      };

      const result = adapter.translateStreamChunk(event);

      expect(result).toBeTruthy();
      expect(result.choices[0].delta.content).toBeUndefined();
      expect(result.choices[0].delta.reasoning_content).toBeUndefined();
      expect(result.choices[0].delta.reasoning_details).toEqual([
        { type: 'thinking', index: 0, signature: 'Er4CCm...' },
      ]);
    });

    test('drops signature_delta events with empty signatures', () => {
      // Defensive: an empty signature should not pollute persistence.
      const event = {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: '' },
      };

      const result = adapter.translateStreamChunk(event);

      expect(result).toBeNull();
    });
  });

  describe('convertAnthropicToOpenAI (non-streaming thinking blocks)', () => {
    test('preserves thinking block text and signature in reasoning_details', () => {
      const anthropicResponse = {
        id: 'msg_123',
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'end_turn',
        content: [
          { type: 'thinking', thinking: 'Some reasoning...', signature: 'sig_abc' },
          { type: 'text', text: 'Final answer.' },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      const result = adapter.convertAnthropicToOpenAI(anthropicResponse);

      expect(result.choices[0].message.content).toBe('Final answer.');
      // Thinking text is not part of the visible content string.
      expect(result.choices[0].message.reasoning_details).toEqual([
        { type: 'thinking', index: 0, text: 'Some reasoning...', signature: 'sig_abc' },
      ]);
    });

    test('handles a thinking block with no signature', () => {
      const anthropicResponse = {
        id: 'msg_123',
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'end_turn',
        content: [
          { type: 'thinking', thinking: 'Some reasoning...' },
          { type: 'text', text: 'Final answer.' },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      const result = adapter.convertAnthropicToOpenAI(anthropicResponse);

      expect(result.choices[0].message.reasoning_details).toEqual([
        { type: 'thinking', index: 0, text: 'Some reasoning...' },
      ]);
    });
  });

  describe('normalizeMessageForAnthropic (request-side round-trip)', () => {
    test('emits Anthropic thinking content blocks from reasoning_details', async () => {
      const internalRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'user', content: 'Hi' },
          {
            role: 'assistant',
            content: 'Hello!',
            reasoning_details: [
              { type: 'thinking', index: 0, text: 'Reasoning...', signature: 'sig_abc' },
            ],
          },
          { role: 'user', content: 'Tell me more.' },
        ],
      };

      const result = await adapter.translateRequest(internalRequest);

      const assistantMessage = result.messages.find((m) => m.role === 'assistant');
      expect(assistantMessage).toBeTruthy();
      expect(Array.isArray(assistantMessage.content)).toBe(true);
      const thinkingBlock = assistantMessage.content.find((b) => b.type === 'thinking');
      expect(thinkingBlock).toEqual({
        type: 'thinking',
        thinking: 'Reasoning...',
        signature: 'sig_abc',
      });
    });

    test('emits thinking block with signature only (no text)', async () => {
      const internalRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'user', content: 'Hi' },
          {
            role: 'assistant',
            content: 'Hello!',
            reasoning_details: [
              { type: 'thinking', index: 0, signature: 'sig_abc' },
            ],
          },
        ],
      };

      const result = await adapter.translateRequest(internalRequest);

      const assistantMessage = result.messages.find((m) => m.role === 'assistant');
      const thinkingBlock = assistantMessage.content.find((b) => b.type === 'thinking');
      // The `thinking` field is always set (even to empty string) to satisfy
      // the Anthropic API schema requirement on thinking content blocks.
      expect(thinkingBlock).toEqual({
        type: 'thinking',
        thinking: '',
        signature: 'sig_abc',
      });
    });

    test('ignores non-thinking reasoning_details entries', async () => {
      const internalRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'user', content: 'Hi' },
          {
            role: 'assistant',
            content: 'Hello!',
            reasoning_details: [
              { type: 'encrypted', data: 'opaque' },
              { type: 'thinking', text: 'R', signature: 'sig' },
            ],
          },
        ],
      };

      const result = await adapter.translateRequest(internalRequest);

      const assistantMessage = result.messages.find((m) => m.role === 'assistant');
      const thinkingBlocks = assistantMessage.content.filter((b) => b.type === 'thinking');
      expect(thinkingBlocks).toHaveLength(1);
      expect(thinkingBlocks[0]).toEqual({
        type: 'thinking',
        thinking: 'R',
        signature: 'sig',
      });
    });
  });
});
