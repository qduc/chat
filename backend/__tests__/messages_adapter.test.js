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

      expect(result.max_tokens).toBe(4096);
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
      expect(result.choices[0].finish_reason).toBe('end_turn');
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
  });
});
