import assert from 'node:assert/strict';
import { addPromptCaching, estimateCacheSavings } from '../src/lib/promptCaching.js';

describe('promptCaching', () => {
  let mockProvider;

  beforeEach(() => {
    mockProvider = {
      supportsPromptCaching: () => true,
      providerId: 'openai'
    };
  });

  describe('addPromptCaching', () => {
    test('should skip caching when provider does not support it', async () => {
      const nonCachingProvider = {
        supportsPromptCaching: () => false,
        providerId: 'test'
      };

      const body = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello!' }
        ]
      };

      const result = await addPromptCaching(body, {
        provider: nonCachingProvider,
        conversationId: 'conv-123',
        userId: 'user-456'
      });

      assert.deepEqual(result, body);
      assert.equal(result.messages[0].cache_control, undefined);
    });

    test('should skip caching when messages array is empty', async () => {
      const body = { messages: [] };

      const result = await addPromptCaching(body, {
        provider: mockProvider,
        conversationId: 'conv-123',
        userId: 'user-456'
      });

      assert.deepEqual(result, body);
    });

    test('should skip caching when messages is not an array', async () => {
      const body = { messages: null };

      const result = await addPromptCaching(body, {
        provider: mockProvider,
        conversationId: 'conv-123',
        userId: 'user-456'
      });

      assert.deepEqual(result, body);
    });

    test('should add cache_control to first system and last user message in short conversation', async () => {
      const body = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello!' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' }
        ]
      };

      const result = await addPromptCaching(body, {
        provider: mockProvider,
        conversationId: 'conv-123',
        userId: 'user-456'
      });

      // Should add cache_control to first system message and last user message
      // String content is converted to content-block format with cache_control
      const systemMessage = result.messages[0];
      assert.ok(Array.isArray(systemMessage.content), 'System message content should be converted to array');
      assert.deepEqual(systemMessage.content[0].cache_control, { type: 'ephemeral' });

      const lastUserMessage = result.messages[3];
      assert.ok(Array.isArray(lastUserMessage.content), 'Last user message content should be converted to array');
      assert.deepEqual(lastUserMessage.content[0].cache_control, { type: 'ephemeral' });

      // Count total cache points (in content arrays)
      const cachePoints = result.messages.filter(m => {
        if (m.cache_control) return true;
        if (Array.isArray(m.content)) {
          return m.content.some(item => item.cache_control);
        }
        return false;
      });
      assert.equal(cachePoints.length, 2);

      // Non-cached messages should not have cache_control
      assert.equal(result.messages[1].cache_control, undefined);
      assert.equal(result.messages[2].cache_control, undefined);
    });

    test('should not add cache_control to trailing system message, only first system and last user', async () => {
      const body = {
        messages: [
          { role: 'user', content: 'Hello!' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'system', content: 'You are a helpful assistant.' }
        ]
      };

      const result = await addPromptCaching(body, {
        provider: mockProvider,
        conversationId: 'conv-123',
        userId: 'user-456'
      });

      // The trailing system message at index 2 is NOT the first message, so no system cache point.
      // The last user message is at index 0, so it gets the cache point.
      assert.ok(Array.isArray(result.messages[0].content), 'User message content should be converted to array');
      assert.deepEqual(result.messages[0].content[0].cache_control, { type: 'ephemeral' });

      // Trailing system message should not get cache_control
      assert.equal(result.messages[2].cache_control, undefined);
      if (Array.isArray(result.messages[2].content)) {
        const hasCache = result.messages[2].content.some(item => item.cache_control);
        assert.equal(hasCache, false);
      }
    });

    test('should add cache points to first system and last user message', async () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'assistant', content: 'Response 2' },
        { role: 'user', content: 'Message 3' },
        { role: 'assistant', content: 'Response 3' },
        { role: 'user', content: 'Message 4' },
        { role: 'assistant', content: 'Response 4' },
        { role: 'user', content: 'Message 5' },
        { role: 'assistant', content: 'Response 5' }
      ];

      const body = { messages };

      const result = await addPromptCaching(body, {
        provider: mockProvider,
        conversationId: 'conv-123',
        userId: 'user-456'
      });

      // Count cache_control points (in content arrays)
      const cachePoints = result.messages.filter(m => {
        if (m.cache_control) return true;
        if (Array.isArray(m.content)) {
          return m.content.some(item => item.cache_control);
        }
        return false;
      });
      // First system message + last user message = 2 cache points
      assert.equal(cachePoints.length, 2);

      // First system message should have cache_control in content
      assert.ok(Array.isArray(result.messages[0].content));
      assert.deepEqual(result.messages[0].content[0].cache_control, { type: 'ephemeral' });

      // Last user message (index 9) should have cache_control in content
      assert.ok(Array.isArray(result.messages[9].content));
      assert.deepEqual(result.messages[9].content[0].cache_control, { type: 'ephemeral' });
    });

    test('should handle multi-modal content in messages', async () => {
      const body = {
        messages: [
          {
            role: 'system',
            content: [
              { type: 'text', text: 'You are a helpful assistant.' }
            ]
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is in this image?' },
              { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } }
            ]
          }
        ]
      };

      const result = await addPromptCaching(body, {
        provider: mockProvider,
        conversationId: 'conv-123',
        userId: 'user-456'
      });

      // System message (first) gets cache_control on last content item
      const systemContent = result.messages[0].content;
      assert.deepEqual(systemContent[systemContent.length - 1].cache_control, { type: 'ephemeral' });

      // Last user message gets cache_control on last content item (the image_url)
      const userContent = result.messages[1].content;
      assert.deepEqual(userContent[userContent.length - 1].cache_control, { type: 'ephemeral' });
    });

    test('should return original body on error without throwing', async () => {
      // Mock provider to throw an error
      const errorProvider = {
        supportsPromptCaching: () => {
          throw new Error('Provider error');
        },
        providerId: 'error'
      };

      const body = {
        messages: [
          { role: 'system', content: 'Test' }
        ]
      };

      const result = await addPromptCaching(body, {
        provider: errorProvider,
        conversationId: 'conv-123',
        userId: 'user-456'
      });

      // Should return original body without modifications
      assert.deepEqual(result, body);
      assert.equal(result.messages[0].cache_control, undefined);
    });

    test('should work with tool-enabled requests', async () => {
      const body = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant with tools.' },
          { role: 'user', content: 'Use the calculator tool.' },
          { role: 'assistant', content: 'I will use the calculator.' }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'calculator',
              description: 'Perform calculations',
              parameters: { type: 'object', properties: {} }
            }
          }
        ]
      };

      const result = await addPromptCaching(body, {
        provider: mockProvider,
        conversationId: 'conv-123',
        userId: 'user-456',
        hasTools: true
      });

      // First system message gets cache_control in content
      assert.ok(Array.isArray(result.messages[0].content));
      assert.deepEqual(result.messages[0].content[0].cache_control, { type: 'ephemeral' });

      // Last user message gets cache_control in content
      assert.ok(Array.isArray(result.messages[1].content));
      assert.deepEqual(result.messages[1].content[0].cache_control, { type: 'ephemeral' });
    });
  });

  describe('estimateCacheSavings', () => {
    test('should return zero for empty messages', () => {
      const result = estimateCacheSavings([]);

      assert.deepEqual(result, {
        cacheable: 0,
        total: 0,
        percentage: 0,
        cachePoints: 0
      });
    });

    test('should return zero for null/undefined input', () => {
      const resultNull = estimateCacheSavings(null);
      const resultUndefined = estimateCacheSavings(undefined);

      assert.deepEqual(resultNull, {
        cacheable: 0,
        total: 0,
        percentage: 0,
        cachePoints: 0
      });

      assert.deepEqual(resultUndefined, {
        cacheable: 0,
        total: 0,
        percentage: 0,
        cachePoints: 0
      });
    });

    test('should estimate tokens for text content', () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.', cache_control: { type: 'ephemeral' } },
        { role: 'user', content: 'Hello, how are you?' },
        { role: 'assistant', content: 'I am doing well, thank you!' }
      ];

      const result = estimateCacheSavings(messages);

      assert.ok(result.total > 0);
      assert.ok(result.cacheable > 0);
      assert.equal(result.cachePoints, 1);
      assert.ok(result.percentage > 0);
    });

    test('should handle multi-modal content arrays', () => {
      const messages = [
        {
          role: 'system',
          content: [{ type: 'text', text: 'You are a helpful assistant.' }],
          cache_control: { type: 'ephemeral' }
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } }
          ]
        }
      ];

      const result = estimateCacheSavings(messages);

      assert.ok(result.total > 0);
      assert.ok(result.cacheable > 0);
      assert.equal(result.cachePoints, 1);
    });

    test('should accumulate cacheable tokens after first cache point', () => {
      const messages = [
        { role: 'user', content: 'Message before cache' },
        { role: 'system', content: 'Cached system message', cache_control: { type: 'ephemeral' } },
        { role: 'user', content: 'Message after cache' },
        { role: 'assistant', content: 'Response after cache' }
      ];

      const result = estimateCacheSavings(messages);

      // Only messages after the cache point should be cacheable
      assert.ok(result.cacheable < result.total);
      assert.equal(result.cachePoints, 1);
    });

    test('should handle multiple cache points', () => {
      const messages = [
        { role: 'system', content: 'System message', cache_control: { type: 'ephemeral' } },
        { role: 'user', content: 'User message 1' },
        { role: 'assistant', content: 'Assistant message 1', cache_control: { type: 'ephemeral' } },
        { role: 'user', content: 'User message 2' }
      ];

      const result = estimateCacheSavings(messages);

      assert.equal(result.cachePoints, 2);
      assert.ok(result.cacheable > 0);
    });

    test('should calculate percentage correctly', () => {
      const messages = [
        { role: 'system', content: 'A'.repeat(100), cache_control: { type: 'ephemeral' } },
        { role: 'user', content: 'B'.repeat(100) }
      ];

      const result = estimateCacheSavings(messages);

      // Both messages should contribute to total
      // Only the second message (after cache point) should be cacheable
      assert.ok(result.percentage > 0);
      assert.ok(result.percentage <= 100);
    });
  });
});
