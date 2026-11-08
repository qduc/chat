import { describe, expect, test } from '@jest/globals';
import {
  CHATFORGE_PROVIDER_INPUT,
  chatMessagesToItems,
  itemsToChatMessages,
} from '../../src/lib/harness/chatMessages.ts';
import type { ChatMessage } from '../../src/lib/harness/chatMessages.ts';

describe('chatMessagesToItems / itemsToChatMessages', () => {
  const history: ChatMessage[] = [
    { role: 'system', content: 'You are ChatForge.' },
    { role: 'user', content: 'Find the Node 24 release notes' },
    {
      role: 'assistant',
      content: 'Searching.',
      reasoning_details: [{ type: 'reasoning.encrypted', index: 0, data: 'opaque' }],
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'web_search', arguments: '{"query":"node 24"}' },
          gemini_thought_signature: 'sig',
        },
      ],
    },
    { role: 'tool', tool_call_id: 'call_1', content: '{"results":[]}' },
    { role: 'assistant', content: 'Nothing found.' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What about this?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA', detail: 'low' } },
      ],
    },
  ];

  test('maps history to portable items', () => {
    const { instructions, items } = chatMessagesToItems(history);
    expect(instructions).toBe('You are ChatForge.');
    expect(items.map((item) => item.type)).toEqual([
      'user_message',
      'reasoning',
      'assistant_message',
      'tool_call',
      'tool_result',
      'assistant_message',
      'user_message',
    ]);
    expect(items[3]).toMatchObject({
      callId: 'call_1',
      toolName: 'web_search',
      input: { query: 'node 24' },
      providerMetadata: { gemini_thought_signature: 'sig' },
    });
    expect(items[6]).toMatchObject({
      content: [
        { type: 'text', text: 'What about this?' },
        { type: 'image', mediaType: 'image/png', data: 'data:image/png;base64,AAAA', detail: 'low' },
      ],
    });
  });

  test('round-trips exactly', () => {
    const { instructions, items } = chatMessagesToItems(history);
    expect(itemsToChatMessages(items, instructions)).toEqual(history);
  });

  test('keeps messages it cannot represent as provider_input, unchanged', () => {
    const audio: ChatMessage = {
      role: 'user',
      content: [{ type: 'input_audio', input_audio: { data: 'AAAA', format: 'wav' } }],
    };
    const lateSystem: ChatMessage = { role: 'system', content: 'Mid-history notice' };
    const { items } = chatMessagesToItems([{ role: 'user', content: 'hi' }, lateSystem, audio]);

    expect(items.slice(1)).toEqual([
      expect.objectContaining({ type: 'provider_input', provider: CHATFORGE_PROVIDER_INPUT, input: lateSystem }),
      expect.objectContaining({ type: 'provider_input', provider: CHATFORGE_PROVIDER_INPUT, input: audio }),
    ]);
    expect(itemsToChatMessages(items)).toEqual([{ role: 'user', content: 'hi' }, lateSystem, audio]);
  });
});
