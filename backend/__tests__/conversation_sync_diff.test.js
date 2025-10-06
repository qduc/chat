/**
 * Integration tests for diff-based conversation sync
 */

import { ConversationManager } from '../src/lib/persistence/ConversationManager.js';
import {
  getAllMessagesForSync
} from '../src/db/messages.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import { getDb, resetDbCache } from '../src/db/index.js';

describe('Diff-Based Conversation Sync', () => {
  let manager;
  let conversationId;
  const userId = 'test-user-123';
  const sessionId = 'test-session-123';

  beforeAll(() => {
    safeTestSetup();
  });

  beforeEach(() => {
    resetDbCache();
    const db = getDb();
    db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM sessions; DELETE FROM providers;');

    manager = new ConversationManager();

    // Create a test conversation
    conversationId = manager.createNewConversation({
      sessionId,
      userId,
      model: 'gpt-4',
      providerId: 'default-provider',
      streamingEnabled: true,
      toolsEnabled: false
    });
  });

  afterEach(() => {
    const db = getDb();
    db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM sessions; DELETE FROM providers;');
  });

  describe('syncMessageHistoryDiff', () => {
    it('should handle fresh conversation (insert only)', () => {
      const messages = [
        { id: 'user-temp', role: 'user', content: 'Hello' },
        { id: 'assistant-temp', role: 'assistant', content: 'Hi there!' }
      ];

      const result = manager.syncMessageHistoryDiff(conversationId, userId, messages);

      const userMapping = result.idMappings.find(mapping => mapping.role === 'user');
      expect(userMapping).toBeDefined();
      expect(userMapping.tempId).toBe('user-temp');
      expect(typeof userMapping.persistedId === 'number' || typeof userMapping.persistedId === 'string').toBe(true);

      const synced = getAllMessagesForSync({ conversationId });
      expect(synced).toHaveLength(2);
      expect(synced[0].role).toBe('user');
      expect(synced[0].content).toBe('Hello');
      expect(synced[1].role).toBe('assistant');
      expect(synced[1].content).toBe('Hi there!');
    });

    it('should append new messages (insert at end)', () => {
      // Initial sync
      const messages1 = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' }
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages1);

      // Append new message
      const messages2 = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' }
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages2);

      const synced = getAllMessagesForSync({ conversationId });
      expect(synced).toHaveLength(3);
      expect(synced[2].role).toBe('user');
      expect(synced[2].content).toBe('How are you?');
    });

    it('should update message content (edit in middle)', () => {
      // Initial sync
      const messages1 = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' }
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages1);

      // Edit assistant message
      const messages2 = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there! How can I help?' }
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages2);

      const synced = getAllMessagesForSync({ conversationId });
      expect(synced).toHaveLength(2);
      expect(synced[1].content).toBe('Hi there! How can I help?');
    });

    it('should delete tail messages (regenerate)', () => {
      // Initial sync with 3 messages
      const messages1 = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' }
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages1);

      // Regenerate last response (remove user message)
      const messages2 = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' }
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages2);

      const synced = getAllMessagesForSync({ conversationId });
      expect(synced).toHaveLength(2);
    });

    it('should handle tool metadata preservation on update', () => {
      // Initial sync with tool calls
      const messages1 = [
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: 'Let me check',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              index: 0,
              function: {
                name: 'get_weather',
                arguments: '{"city":"NYC"}'
              }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'call_123',
          content: 'Sunny, 72F',
          status: 'success'
        }
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages1);

      const synced1 = getAllMessagesForSync({ conversationId });
      expect(synced1).toHaveLength(3);
      expect(synced1[1].tool_calls).toHaveLength(1);
      expect(synced1[2].tool_call_id).toBe('call_123');

      // Update message content but keep tool metadata
      const messages2 = [
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: 'Let me check that for you',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              index: 0,
              function: {
                name: 'get_weather',
                arguments: '{"city":"NYC"}'
              }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'call_123',
          content: 'Sunny, 72F',
          status: 'success'
        }
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages2);

      const synced2 = getAllMessagesForSync({ conversationId });
      expect(synced2).toHaveLength(3);
      expect(synced2[1].content).toBe('Let me check that for you');
      expect(synced2[1].tool_calls).toHaveLength(1);
      expect(synced2[2].tool_call_id).toBe('call_123');
    });

    it('should handle truncated history (suffix alignment)', () => {
      // Initial sync with 3 messages
      const messages1 = [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' }
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages1);

      // Send only last 2 messages (truncated)
      const messages2 = [
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' }
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages2);

      const synced = getAllMessagesForSync({ conversationId });
      expect(synced).toHaveLength(2);
    });

    it('should handle mixed operations (update + insert + delete)', () => {
      // Initial sync
      const messages1 = [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
        { role: 'assistant', content: 'd' }
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages1);

      // Update middle, delete tail, append new
      const messages2 = [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b-edited' },
        { role: 'user', content: 'c' }
        // 'd' deleted
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages2);

      const synced = getAllMessagesForSync({ conversationId });
      expect(synced).toHaveLength(3);
      expect(synced[1].content).toBe('b-edited');
    });

    it('should fall back to legacy sync on alignment failure', () => {
      // Initial sync
      const messages1 = [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' }
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages1);

      // Completely different messages (should trigger fallback)
      const messages2 = [
        { role: 'user', content: 'x' },
        { role: 'assistant', content: 'y' }
      ];

      // Should fall back and still work
      manager.syncMessageHistoryDiff(conversationId, userId, messages2);

      const synced = getAllMessagesForSync({ conversationId });
      expect(synced).toHaveLength(2);
      expect(synced[0].content).toBe('x');
      expect(synced[1].content).toBe('y');
    });

    it('should handle mixed content (images)', () => {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            { type: 'image_url', image_url: { url: 'http://example.com/img.jpg' } }
          ]
        },
        { role: 'assistant', content: 'It looks like an image.' }
      ];

      manager.syncMessageHistoryDiff(conversationId, userId, messages);

      const synced = getAllMessagesForSync({ conversationId });
      expect(synced).toHaveLength(2);
      expect(Array.isArray(synced[0].content)).toBe(true);
      expect(synced[0].content).toHaveLength(2);
    });

    it('should update tool call arguments', () => {
      // Initial sync
      const messages1 = [
        { role: 'user', content: 'Weather in NYC?' },
        {
          role: 'assistant',
          content: 'Checking',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              index: 0,
              function: {
                name: 'get_weather',
                arguments: '{"city":"NYC"}'
              }
            }
          ]
        }
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages1);

      // Update tool call arguments
      const messages2 = [
        { role: 'user', content: 'Weather in NYC?' },
        {
          role: 'assistant',
          content: 'Checking',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              index: 0,
              function: {
                name: 'get_weather',
                arguments: '{"city":"NYC","units":"metric"}'
              }
            }
          ]
        }
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages2);

      const synced = getAllMessagesForSync({ conversationId });
      const toolCalls = synced[1].tool_calls;
      expect(toolCalls).toHaveLength(1);
      expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({
        city: 'NYC',
        units: 'metric'
      });
    });

    it('should replace tool artifacts when structure changes significantly', () => {
      // Initial sync with 1 tool call
      const messages1 = [
        { role: 'user', content: 'Get weather' },
        {
          role: 'assistant',
          content: 'Checking',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              index: 0,
              function: {
                name: 'get_weather',
                arguments: '{}'
              }
            }
          ]
        }
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages1);

      // Update with 2 tool calls (count changed - triggers fallback)
      const messages2 = [
        { role: 'user', content: 'Get weather' },
        {
          role: 'assistant',
          content: 'Checking',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              index: 0,
              function: {
                name: 'get_weather',
                arguments: '{}'
              }
            },
            {
              id: 'call_456',
              type: 'function',
              index: 1,
              function: {
                name: 'get_time',
                arguments: '{}'
              }
            }
          ]
        }
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages2);

      const synced = getAllMessagesForSync({ conversationId });
      expect(synced[1].tool_calls).toHaveLength(2);
    });
  });

  describe('fallback behavior', () => {
    it('should use clear-and-rewrite fallback when alignment fails', () => {
      // Initial sync
      const messages1 = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' }
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages1);

      // Completely different messages should trigger fallback
      const messages2 = [
        { role: 'user', content: 'Completely different topic' },
        { role: 'assistant', content: 'Yes, totally unrelated' }
      ];
      manager.syncMessageHistoryDiff(conversationId, userId, messages2);

      // Should still sync correctly via fallback
      const synced = getAllMessagesForSync({ conversationId });
      expect(synced).toHaveLength(2);
      expect(synced[0].content).toBe('Completely different topic');
      expect(synced[1].content).toBe('Yes, totally unrelated');
    });
  });
});
