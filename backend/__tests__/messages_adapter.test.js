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
    test('keeps prompt-cache breakpoints as system and content blocks', async () => {
      // Shape produced by addPromptCaching: string content becomes text blocks.
      const result = await adapter.translateRequest({
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'system', content: [{ type: 'text', text: 'You are ChatForge.', cache_control: { type: 'ephemeral' } }] },
          { role: 'system', content: 'Today is Sunday.' },
          { role: 'user', content: [{ type: 'text', text: 'Hello!', cache_control: { type: 'ephemeral' } }] },
        ],
      });

      expect(result.system).toEqual([
        { type: 'text', text: 'You are ChatForge.', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'Today is Sunday.' },
      ]);
      expect(result.messages).toEqual([
        { role: 'user', content: [{ type: 'text', text: 'Hello!', cache_control: { type: 'ephemeral' } }] },
      ]);
    });

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

  describe('Claude 5.5 request adjustments', () => {
    function anthropicAdapter() {
      return new MessagesAdapter({
        config: {},
        settings: {},
        getDefaultModel: () => 'claude-3-5-sonnet-20241022',
        reasoningFormat: 'anthropic',
      });
    }

    const lookupTool = {
      type: 'function',
      function: {
        name: 'lookup',
        description: 'Look up a record',
        parameters: { type: 'object', properties: { q: { type: 'string' } } },
      },
    };

    const normalizedLookupTool = {
      name: 'lookup',
      description: 'Look up a record',
      input_schema: { type: 'object', properties: { q: { type: 'string' } } },
    };

    function request(model, extra = {}) {
      return {
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        ...extra,
      };
    }

    // Same body ConversationTitleService._requestTitleFromAPI sends.
    const TITLE_SYSTEM = 'You create a very short, descriptive chat title (max 6 words). Output only the title, no quotes, no punctuation at the end.';

    function titleRequest(model) {
      return {
        model,
        temperature: 0.2,
        max_tokens: 20,
        messages: [
          { role: 'system', content: TITLE_SYSTEM },
          { role: 'user', content: 'Create a short title for: Hello there' },
        ],
      };
    }

    function combinedRequest(model, effort = 'none') {
      return request(model, {
        reasoning_effort: effort,
        temperature: 0.2,
        top_p: 0.95,
        top_k: 40,
        tools: [lookupTool],
        tool_choice: 'required',
      });
    }

    function historicalShape(model) {
      return {
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        tools: [normalizedLookupTool],
        tool_choice: { type: 'any' },
        temperature: 0.2,
        top_p: 0.95,
        top_k: 40,
        thinking: { type: 'disabled' },
      };
    }

    const opus55Ids = ['claude-opus-5-5', 'claude-opus-5-5-20251101', 'anthropic::claude-opus-5-5'];
    const sonnet55Ids = ['claude-sonnet-5-5', 'claude-sonnet-5-5-20260301', 'Claude-Sonnet-5-5'];
    const haiku55Ids = ['claude-haiku-5-5', 'claude-haiku-5-5-latest'];
    const earlierIds = [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
      'claude-opus-4-5',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      // Date suffix is not a minor version. These must stay on the historical shape.
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-opus-4-1-20250805',
    ];
    // Sampling is rejected on Claude 4.7+. Thinking and tool_choice stay historical.
    const claude47Ids = [
      'claude-opus-4-7',
      'claude-opus-4-7-20260101',
      'claude-opus-4-7-20260501',
      'claude-opus-4-8',
      'claude-sonnet-4-7',
    ];

    describe('effort none and minimal', () => {
      test.each(opus55Ids.flatMap((model) => ['none', 'minimal'].map((effort) => [model, effort])))(
        '%s %s sends adaptive thinking with effort low',
        async (model, effort) => {
          const result = await anthropicAdapter().translateRequest(combinedRequest(model, effort));
          expect(result.thinking).toEqual({ type: 'adaptive' });
          expect(result.output_config).toEqual({ effort: 'low' });
          expect(result.model).toBe(model);
        }
      );

      test.each(sonnet55Ids.flatMap((model) => ['none', 'minimal'].map((effort) => [model, effort])))(
        '%s %s sends between_tools and no effort',
        async (model, effort) => {
          const result = await anthropicAdapter().translateRequest(combinedRequest(model, effort));
          expect(result.thinking).toEqual({ type: 'between_tools' });
          expect(result.output_config).toBeUndefined();
          expect(result.model).toBe(model);
        }
      );

      test.each(haiku55Ids.flatMap((model) => ['none', 'minimal'].map((effort) => [model, effort])))(
        '%s %s keeps thinking disabled',
        async (model, effort) => {
          const result = await anthropicAdapter().translateRequest(combinedRequest(model, effort));
          expect(result.thinking).toEqual({ type: 'disabled' });
          expect(result.output_config).toBeUndefined();
        }
      );

      test.each([...earlierIds, ...claude47Ids].flatMap((model) => ['none', 'minimal'].map((effort) => [model, effort])))(
        '%s %s stays thinking disabled with no output_config',
        async (model, effort) => {
          const result = await anthropicAdapter().translateRequest(request(model, { reasoning_effort: effort }));
          expect(result.thinking).toEqual({ type: 'disabled' });
          expect(result.output_config).toBeUndefined();
        }
      );
    });

    describe('sampling parameters', () => {
      test.each([...opus55Ids, ...sonnet55Ids, ...haiku55Ids, ...claude47Ids])(
        '%s omits temperature, top_p, and top_k',
        async (model) => {
          const result = await anthropicAdapter().translateRequest(combinedRequest(model));
          expect(result).not.toHaveProperty('temperature');
          expect(result).not.toHaveProperty('top_p');
          expect(result).not.toHaveProperty('top_k');
        }
      );

      test.each(earlierIds)('%s keeps temperature, top_p, and top_k', async (model) => {
        const result = await anthropicAdapter().translateRequest(combinedRequest(model));
        expect(result.temperature).toBe(0.2);
        expect(result.top_p).toBe(0.95);
        expect(result.top_k).toBe(40);
      });

      test('strips sampling params reintroduced by custom_request_params on 5.5 models', async () => {
        const result = await anthropicAdapter().translateRequest(request('claude-opus-5-5', {
          custom_request_params: { temperature: 1, top_p: 1, top_k: 5 },
        }));
        expect(result).not.toHaveProperty('temperature');
        expect(result).not.toHaveProperty('top_p');
        expect(result).not.toHaveProperty('top_k');
      });

      test('keeps sampling params from custom_request_params on earlier models', async () => {
        const result = await anthropicAdapter().translateRequest(request('claude-opus-4-5', {
          custom_request_params: { temperature: 0.4, top_p: 0.9, top_k: 10 },
        }));
        expect(result.temperature).toBe(0.4);
        expect(result.top_p).toBe(0.9);
        expect(result.top_k).toBe(10);
      });
    });

    describe('tool_choice required', () => {
      test.each([...opus55Ids, ...sonnet55Ids])(
        '%s downgrades required and named tool choice to auto',
        async (model) => {
          const required = await anthropicAdapter().translateRequest(combinedRequest(model));
          expect(required.tool_choice).toEqual({ type: 'auto' });

          const named = await anthropicAdapter().translateRequest(request(model, {
            tools: [lookupTool],
            tool_choice: { type: 'function', function: { name: 'lookup' } },
          }));
          expect(named.tool_choice).toEqual({ type: 'auto' });

          const auto = await anthropicAdapter().translateRequest(request(model, {
            tools: [lookupTool],
            tool_choice: 'auto',
          }));
          expect(auto.tool_choice).toEqual({ type: 'auto' });
        }
      );

      test.each([...haiku55Ids, ...earlierIds, ...claude47Ids])(
        '%s keeps required as any and named tool choice as tool',
        async (model) => {
          const required = await anthropicAdapter().translateRequest(combinedRequest(model));
          expect(required.tool_choice).toEqual({ type: 'any' });

          const named = await anthropicAdapter().translateRequest(request(model, {
            tools: [lookupTool],
            tool_choice: { type: 'function', function: { name: 'lookup' } },
          }));
          expect(named.tool_choice).toEqual({ type: 'tool', name: 'lookup' });
        }
      );
    });

    describe('unchanged request shapes', () => {
      test.each(earlierIds)('%s combined request matches the historical shape', async (model) => {
        const result = await anthropicAdapter().translateRequest(combinedRequest(model, 'minimal'));
        expect(result).toEqual(historicalShape(model));
      });

      test.each([
        'claude-sonnet-4-20250514',
        'claude-opus-4-20250514',
        'claude-opus-4-1-20250805',
        'claude-sonnet-4-5-20250929',
      ])('date suffix on %s is not a 4.7 minor version', async (model) => {
        const result = await anthropicAdapter().translateRequest(combinedRequest(model, 'none'));
        expect(result).toEqual(historicalShape(model));
        expect(result.temperature).toBe(0.2);
        expect(result.top_p).toBe(0.95);
        expect(result.top_k).toBe(40);
        expect(result.tool_choice).toEqual({ type: 'any' });
        expect(result.thinking).toEqual({ type: 'disabled' });
      });

      test.each(['claude-opus-4-7', 'claude-opus-4-7-20260101'])(
        '%s still strips sampling parameters',
        async (model) => {
          const result = await anthropicAdapter().translateRequest(combinedRequest(model, 'none'));
          expect(result).not.toHaveProperty('temperature');
          expect(result).not.toHaveProperty('top_p');
          expect(result).not.toHaveProperty('top_k');
          expect(result.thinking).toEqual({ type: 'disabled' });
          expect(result.tool_choice).toEqual({ type: 'any' });
        }
      );

      test.each(claude47Ids)('%s drops sampling params and otherwise matches the historical shape', async (model) => {
        const result = await anthropicAdapter().translateRequest(combinedRequest(model, 'none'));
        const expected = historicalShape(model);
        delete expected.temperature;
        delete expected.top_p;
        delete expected.top_k;
        expect(result).toEqual(expected);
      });

      test.each([
        ['claude-opus-5-5', { type: 'adaptive' }, { effort: 'low' }, { type: 'auto' }],
        ['claude-sonnet-5-5-20260301', { type: 'between_tools' }, undefined, { type: 'auto' }],
        ['claude-haiku-5-5', { type: 'disabled' }, undefined, { type: 'any' }],
      ])('%s combined request applies only its own adjustments', async (model, thinking, outputConfig, toolChoice) => {
        const result = await anthropicAdapter().translateRequest(combinedRequest(model));
        expect(result).toEqual({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 100,
          tools: [normalizedLookupTool],
          tool_choice: toolChoice,
          thinking,
          ...(outputConfig ? { output_config: outputConfig } : {}),
        });
      });

      test.each(['low', 'medium', 'high', 'xhigh', 'max'])(
        'effort %s on the 5.5 models stays adaptive with summarized display',
        async (effort) => {
          for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-4-5']) {
            const result = await anthropicAdapter().translateRequest(request(model, {
              reasoning_effort: effort,
              temperature: 0.3,
            }));
            expect(result.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
            expect(result.output_config).toEqual({ effort });
            if (model === 'claude-opus-4-5') {
              expect(result.temperature).toBe(0.3);
            } else {
              expect(result).not.toHaveProperty('temperature');
            }
          }
        }
      );

      test('claude-opus-5 strips sampling params without the 5.5 thinking or tool_choice changes', async () => {
        const result = await anthropicAdapter().translateRequest(combinedRequest('claude-opus-5', 'minimal'));
        const expected = historicalShape('claude-opus-5');
        delete expected.temperature;
        delete expected.top_p;
        delete expected.top_k;
        expect(result).toEqual(expected);
      });

      test('reasoningFormat none still omits thinking on Opus 5.5 and still strips temperature', async () => {
        const adapter = new MessagesAdapter({
          config: {},
          settings: {},
          getDefaultModel: () => 'claude-3-5-sonnet-20241022',
        });
        const result = await adapter.translateRequest(request('claude-opus-5-5', {
          reasoning_effort: 'none',
          temperature: 0.2,
        }));
        expect(result.thinking).toBeUndefined();
        expect(result.output_config).toBeUndefined();
        expect(result).not.toHaveProperty('temperature');
      });
    });

    describe('title generation', () => {
      test.each([
        'claude-opus-5-5',
        'claude-sonnet-5-5',
        'claude-haiku-5-5',
        'claude-opus-5-5-20251101',
        'claude-opus-4-7',
      ])('title request for %s carries no temperature', async (model) => {
        const result = await anthropicAdapter().translateRequest(titleRequest(model));
        expect(result).toEqual({
          model,
          max_tokens: 20,
          system: TITLE_SYSTEM,
          messages: [{ role: 'user', content: 'Create a short title for: Hello there' }],
        });
        expect(result).not.toHaveProperty('temperature');
      });

      test.each(['claude-3-5-sonnet-20241022', 'claude-opus-4-5', 'claude-sonnet-4-5'])(
        'title request for %s still sends temperature 0.2',
        async (model) => {
          const result = await anthropicAdapter().translateRequest(titleRequest(model));
          expect(result).toEqual({
            model,
            max_tokens: 20,
            temperature: 0.2,
            system: TITLE_SYSTEM,
            messages: [{ role: 'user', content: 'Create a short title for: Hello there' }],
          });
        }
      );
    });
  });
});
