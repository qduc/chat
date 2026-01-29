/**
 * Tests for toolCalls database module
 * Covers insert/update/delete operations for tool calls and outputs
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { config } from '../src/env.js';
import { getDb, resetDbCache } from '../src/db/index.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import { ensureTestUser, TEST_USER_ID, ensureTestConversation } from './helpers/systemPromptsTestUtils.js';
import {
  insertToolCall,
  insertToolCalls,
  getToolCallsByMessageId,
  getToolCallsByMessageIds,
  getToolCallsByConversationId,
  insertToolOutput,
  insertToolOutputs,
  getToolOutputsByToolCallId,
  getToolOutputsByToolCallIds,
  getToolOutputsByMessageId,
  getToolOutputsByMessageIds,
  deleteToolCallsAndOutputsByMessageId,
  updateToolCall,
  updateToolOutput,
  replaceAssistantArtifacts
} from '../src/db/toolCalls.js';

const TEST_CONVERSATION_ID = 'test-conversation';

beforeAll(() => {
  safeTestSetup();
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  getDb();
  ensureTestUser();
});

beforeEach(() => {
  const db = getDb();
  // Clean up related tables
  db.prepare('DELETE FROM tool_outputs').run();
  db.prepare('DELETE FROM tool_calls').run();
  db.prepare('DELETE FROM messages').run();
  db.prepare('DELETE FROM conversations').run();
  ensureTestUser();
  ensureTestConversation(TEST_CONVERSATION_ID);
  // Reset message seq counter
  messageSeq = 0;
});

afterAll(() => {
  resetDbCache();
});

// Helper to create a test message
let messageSeq = 0; // Counter for unique seq values
function createTestMessage(conversationId, role = 'assistant') {
  const db = getDb();
  messageSeq++;
  const result = db.prepare(`
    INSERT INTO messages (conversation_id, role, content, seq, created_at)
    VALUES (@conversationId, @role, @content, @seq, CURRENT_TIMESTAMP)
  `).run({
    conversationId,
    role,
    content: 'Test message content',
    seq: messageSeq
  });
  return result.lastInsertRowid;
}

describe('toolCalls database module', () => {
  describe('insertToolCall', () => {
    test('inserts a tool call with all fields', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);

      const result = insertToolCall({
        id: 'call_123',
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        callIndex: 0,
        toolName: 'web_search',
        arguments: { query: 'test' },
        textOffset: 50
      });

      expect(result.id).toBe('call_123');
      expect(result.messageId).toBe(messageId);
      expect(result.conversationId).toBe(TEST_CONVERSATION_ID);
      expect(result.callIndex).toBe(0);
      expect(result.toolName).toBe('web_search');
      expect(result.arguments).toBe('{"query":"test"}');
      expect(result.textOffset).toBe(50);
    });

    test('stringifies object arguments', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);

      const result = insertToolCall({
        id: 'call_456',
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        toolName: 'web_fetch',
        arguments: { url: 'https://example.com', max_chars: 1000 }
      });

      expect(result.arguments).toBe('{"url":"https://example.com","max_chars":1000}');
    });

    test('keeps string arguments as-is', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);

      const result = insertToolCall({
        id: 'call_789',
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        toolName: 'get_time',
        arguments: '{"timezone":"UTC"}'
      });

      expect(result.arguments).toBe('{"timezone":"UTC"}');
    });

    test('uses default values for optional fields', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);

      const result = insertToolCall({
        id: 'call_default',
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        toolName: 'test_tool',
        arguments: '{}'
      });

      expect(result.callIndex).toBe(0);
      expect(result.textOffset).toBeNull();
    });
  });

  describe('insertToolCalls', () => {
    test('inserts multiple tool calls', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);

      const toolCalls = [
        { id: 'call_1', function: { name: 'web_search', arguments: '{"query":"q1"}' } },
        { id: 'call_2', function: { name: 'web_fetch', arguments: '{"url":"u1"}' }, index: 1 },
        { id: 'call_3', name: 'get_time', arguments: '{}', index: 2 } // Alternative format
      ];

      const results = insertToolCalls({
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        toolCalls
      });

      expect(results).toHaveLength(3);
      expect(results[0].toolName).toBe('web_search');
      expect(results[1].toolName).toBe('web_fetch');
      expect(results[1].callIndex).toBe(1);
      expect(results[2].toolName).toBe('get_time');
    });

    test('returns empty array for empty input', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);

      expect(insertToolCalls({ messageId, conversationId: TEST_CONVERSATION_ID, toolCalls: [] })).toEqual([]);
      expect(insertToolCalls({ messageId, conversationId: TEST_CONVERSATION_ID, toolCalls: null })).toEqual([]);
    });

    test('handles textOffset in tool calls', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);

      const toolCalls = [
        { id: 'call_offset', function: { name: 'test', arguments: '{}' }, textOffset: 100 }
      ];

      const results = insertToolCalls({
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        toolCalls
      });

      expect(results[0].textOffset).toBe(100);
    });
  });

  describe('getToolCallsByMessageId', () => {
    test('retrieves tool calls for a message ordered by call_index', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);

      // Insert in reverse order
      insertToolCall({
        id: 'call_c',
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        callIndex: 2,
        toolName: 'tool_c',
        arguments: '{}'
      });
      insertToolCall({
        id: 'call_a',
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        callIndex: 0,
        toolName: 'tool_a',
        arguments: '{}'
      });
      insertToolCall({
        id: 'call_b',
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        callIndex: 1,
        toolName: 'tool_b',
        arguments: '{}'
      });

      const calls = getToolCallsByMessageId(messageId);

      expect(calls).toHaveLength(3);
      expect(calls[0].tool_name).toBe('tool_a');
      expect(calls[1].tool_name).toBe('tool_b');
      expect(calls[2].tool_name).toBe('tool_c');
    });

    test('returns empty array for message with no tool calls', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);
      const calls = getToolCallsByMessageId(messageId);
      expect(calls).toEqual([]);
    });
  });

  describe('getToolCallsByMessageIds', () => {
    test('retrieves tool calls for multiple messages grouped by message_id', () => {
      const msg1 = createTestMessage(TEST_CONVERSATION_ID);
      const msg2 = createTestMessage(TEST_CONVERSATION_ID);

      insertToolCall({
        id: 'call_m1_1',
        messageId: msg1,
        conversationId: TEST_CONVERSATION_ID,
        toolName: 'tool1',
        arguments: '{}'
      });
      insertToolCall({
        id: 'call_m1_2',
        messageId: msg1,
        conversationId: TEST_CONVERSATION_ID,
        callIndex: 1,
        toolName: 'tool2',
        arguments: '{}'
      });
      insertToolCall({
        id: 'call_m2_1',
        messageId: msg2,
        conversationId: TEST_CONVERSATION_ID,
        toolName: 'tool3',
        arguments: '{}'
      });

      const grouped = getToolCallsByMessageIds([msg1, msg2]);

      expect(Object.keys(grouped)).toHaveLength(2);
      expect(grouped[msg1]).toHaveLength(2);
      expect(grouped[msg2]).toHaveLength(1);
    });

    test('returns empty object for empty input', () => {
      expect(getToolCallsByMessageIds([])).toEqual({});
      expect(getToolCallsByMessageIds(null)).toEqual({});
    });
  });

  describe('getToolCallsByConversationId', () => {
    test('retrieves tool calls for a conversation with limit', () => {
      const msg = createTestMessage(TEST_CONVERSATION_ID);

      for (let i = 0; i < 5; i++) {
        insertToolCall({
          id: `call_${i}`,
          messageId: msg,
          conversationId: TEST_CONVERSATION_ID,
          callIndex: i,
          toolName: `tool_${i}`,
          arguments: '{}'
        });
      }

      const calls = getToolCallsByConversationId(TEST_CONVERSATION_ID, 3);
      expect(calls.length).toBe(3);
    });
  });

  describe('insertToolOutput', () => {
    test('inserts a tool output', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);
      insertToolCall({
        id: 'call_out_1',
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        toolName: 'web_search',
        arguments: '{}'
      });

      const result = insertToolOutput({
        toolCallId: 'call_out_1',
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        output: { results: ['item1', 'item2'] },
        status: 'success'
      });

      expect(result.toolCallId).toBe('call_out_1');
      expect(result.output).toBe('{"results":["item1","item2"]}');
      expect(result.status).toBe('success');
    });

    test('keeps string output as-is', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);
      insertToolCall({
        id: 'call_out_2',
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        toolName: 'test',
        arguments: '{}'
      });

      const result = insertToolOutput({
        toolCallId: 'call_out_2',
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        output: 'Plain text output'
      });

      expect(result.output).toBe('Plain text output');
      expect(result.status).toBe('success');
    });

    test('handles error status', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);
      insertToolCall({
        id: 'call_err',
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        toolName: 'test',
        arguments: '{}'
      });

      const result = insertToolOutput({
        toolCallId: 'call_err',
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        output: 'Error: Something went wrong',
        status: 'error'
      });

      expect(result.status).toBe('error');
    });
  });

  describe('insertToolOutputs', () => {
    test('inserts multiple tool outputs', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);
      insertToolCall({ id: 'call_1', messageId, conversationId: TEST_CONVERSATION_ID, toolName: 't1', arguments: '{}' });
      insertToolCall({ id: 'call_2', messageId, conversationId: TEST_CONVERSATION_ID, callIndex: 1, toolName: 't2', arguments: '{}' });

      const outputs = [
        { tool_call_id: 'call_1', output: 'Output 1' },
        { tool_call_id: 'call_2', output: 'Output 2', status: 'success' }
      ];

      const results = insertToolOutputs({
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        toolOutputs: outputs
      });

      expect(results).toHaveLength(2);
      expect(results[0].output).toBe('Output 1');
      expect(results[1].output).toBe('Output 2');
    });

    test('returns empty array for empty input', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);
      expect(insertToolOutputs({ messageId, conversationId: TEST_CONVERSATION_ID, toolOutputs: [] })).toEqual([]);
    });
  });

  describe('getToolOutputsByToolCallId', () => {
    test('retrieves outputs for a specific tool call', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);
      insertToolCall({ id: 'call_get_1', messageId, conversationId: TEST_CONVERSATION_ID, toolName: 'test', arguments: '{}' });
      insertToolOutput({ toolCallId: 'call_get_1', messageId, conversationId: TEST_CONVERSATION_ID, output: 'First output' });
      insertToolOutput({ toolCallId: 'call_get_1', messageId, conversationId: TEST_CONVERSATION_ID, output: 'Second output' });

      const outputs = getToolOutputsByToolCallId('call_get_1');
      expect(outputs).toHaveLength(2);
    });
  });

  describe('getToolOutputsByToolCallIds', () => {
    test('retrieves outputs for multiple tool calls grouped by tool_call_id', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);
      insertToolCall({ id: 'call_group_1', messageId, conversationId: TEST_CONVERSATION_ID, toolName: 't1', arguments: '{}' });
      insertToolCall({ id: 'call_group_2', messageId, conversationId: TEST_CONVERSATION_ID, callIndex: 1, toolName: 't2', arguments: '{}' });

      insertToolOutput({ toolCallId: 'call_group_1', messageId, conversationId: TEST_CONVERSATION_ID, output: 'O1' });
      insertToolOutput({ toolCallId: 'call_group_2', messageId, conversationId: TEST_CONVERSATION_ID, output: 'O2' });

      const grouped = getToolOutputsByToolCallIds(['call_group_1', 'call_group_2']);

      expect(Object.keys(grouped)).toHaveLength(2);
      expect(grouped['call_group_1']).toHaveLength(1);
      expect(grouped['call_group_2']).toHaveLength(1);
    });

    test('returns empty object for empty input', () => {
      expect(getToolOutputsByToolCallIds([])).toEqual({});
    });
  });

  describe('getToolOutputsByMessageId', () => {
    test('retrieves all outputs for a message', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);
      insertToolCall({ id: 'call_msg_1', messageId, conversationId: TEST_CONVERSATION_ID, toolName: 't1', arguments: '{}' });
      insertToolCall({ id: 'call_msg_2', messageId, conversationId: TEST_CONVERSATION_ID, callIndex: 1, toolName: 't2', arguments: '{}' });

      insertToolOutput({ toolCallId: 'call_msg_1', messageId, conversationId: TEST_CONVERSATION_ID, output: 'Out1' });
      insertToolOutput({ toolCallId: 'call_msg_2', messageId, conversationId: TEST_CONVERSATION_ID, output: 'Out2' });

      const outputs = getToolOutputsByMessageId(messageId);
      expect(outputs).toHaveLength(2);
    });
  });

  describe('getToolOutputsByMessageIds', () => {
    test('retrieves outputs for multiple messages grouped by message_id', () => {
      const msg1 = createTestMessage(TEST_CONVERSATION_ID);
      const msg2 = createTestMessage(TEST_CONVERSATION_ID);

      insertToolCall({ id: 'call_mm_1', messageId: msg1, conversationId: TEST_CONVERSATION_ID, toolName: 't1', arguments: '{}' });
      insertToolCall({ id: 'call_mm_2', messageId: msg2, conversationId: TEST_CONVERSATION_ID, toolName: 't2', arguments: '{}' });

      insertToolOutput({ toolCallId: 'call_mm_1', messageId: msg1, conversationId: TEST_CONVERSATION_ID, output: 'O1' });
      insertToolOutput({ toolCallId: 'call_mm_2', messageId: msg2, conversationId: TEST_CONVERSATION_ID, output: 'O2' });

      const grouped = getToolOutputsByMessageIds([msg1, msg2]);

      expect(Object.keys(grouped)).toHaveLength(2);
      expect(grouped[msg1]).toHaveLength(1);
      expect(grouped[msg2]).toHaveLength(1);
    });

    test('returns empty object for empty input', () => {
      expect(getToolOutputsByMessageIds([])).toEqual({});
    });
  });

  describe('deleteToolCallsAndOutputsByMessageId', () => {
    test('deletes all tool calls and outputs for a message', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);

      insertToolCall({ id: 'call_del_1', messageId, conversationId: TEST_CONVERSATION_ID, toolName: 't1', arguments: '{}' });
      insertToolCall({ id: 'call_del_2', messageId, conversationId: TEST_CONVERSATION_ID, callIndex: 1, toolName: 't2', arguments: '{}' });
      insertToolOutput({ toolCallId: 'call_del_1', messageId, conversationId: TEST_CONVERSATION_ID, output: 'O1' });
      insertToolOutput({ toolCallId: 'call_del_2', messageId, conversationId: TEST_CONVERSATION_ID, output: 'O2' });

      const result = deleteToolCallsAndOutputsByMessageId(messageId);

      expect(result.toolCallsDeleted).toBe(2);
      expect(result.toolOutputsDeleted).toBe(2);
      expect(getToolCallsByMessageId(messageId)).toEqual([]);
      expect(getToolOutputsByMessageId(messageId)).toEqual([]);
    });
  });

  describe('updateToolCall', () => {
    test('updates tool call fields', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);
      insertToolCall({
        id: 'call_upd',
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        toolName: 'old_tool',
        arguments: '{"old":"args"}'
      });

      const updated = updateToolCall({
        id: 'call_upd',
        conversationId: TEST_CONVERSATION_ID,
        toolName: 'new_tool',
        arguments: { new: 'args' }
      });

      expect(updated).toBe(true);

      const calls = getToolCallsByMessageId(messageId);
      expect(calls[0].tool_name).toBe('new_tool');
      expect(calls[0].arguments).toBe('{"new":"args"}');
    });

    test('returns false for non-existent tool call', () => {
      const updated = updateToolCall({
        id: 'nonexistent',
        conversationId: TEST_CONVERSATION_ID,
        toolName: 'test',
        arguments: '{}'
      });

      expect(updated).toBe(false);
    });
  });

  describe('updateToolOutput', () => {
    test('updates tool output fields', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);
      insertToolCall({ id: 'call_upd_out', messageId, conversationId: TEST_CONVERSATION_ID, toolName: 't', arguments: '{}' });
      const inserted = insertToolOutput({
        toolCallId: 'call_upd_out',
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        output: 'original',
        status: 'success'
      });

      const updated = updateToolOutput({
        id: inserted.id,
        output: { updated: true },
        status: 'error'
      });

      expect(updated).toBe(true);

      const outputs = getToolOutputsByToolCallId('call_upd_out');
      expect(outputs[0].output).toBe('{"updated":true}');
      expect(outputs[0].status).toBe('error');
    });

    test('returns false for non-existent tool output', () => {
      const updated = updateToolOutput({
        id: 99999,
        output: 'test',
        status: 'success'
      });

      expect(updated).toBe(false);
    });
  });

  describe('replaceAssistantArtifacts', () => {
    test('replaces all artifacts for a message', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);

      // Insert initial artifacts
      insertToolCall({ id: 'call_old', messageId, conversationId: TEST_CONVERSATION_ID, toolName: 'old', arguments: '{}' });
      insertToolOutput({ toolCallId: 'call_old', messageId, conversationId: TEST_CONVERSATION_ID, output: 'old output' });

      // Replace with new artifacts
      replaceAssistantArtifacts({
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        toolCalls: [
          { id: 'call_new_1', function: { name: 'new1', arguments: '{}' } },
          { id: 'call_new_2', function: { name: 'new2', arguments: '{}' }, index: 1 }
        ],
        toolOutputs: [
          { tool_call_id: 'call_new_1', output: 'new output 1' },
          { tool_call_id: 'call_new_2', output: 'new output 2' }
        ]
      });

      const calls = getToolCallsByMessageId(messageId);
      expect(calls).toHaveLength(2);
      expect(calls[0].tool_name).toBe('new1');
      expect(calls[1].tool_name).toBe('new2');

      const outputs = getToolOutputsByMessageId(messageId);
      expect(outputs).toHaveLength(2);
    });

    test('handles empty replacement arrays', () => {
      const messageId = createTestMessage(TEST_CONVERSATION_ID);

      insertToolCall({ id: 'call_to_remove', messageId, conversationId: TEST_CONVERSATION_ID, toolName: 'test', arguments: '{}' });

      replaceAssistantArtifacts({
        messageId,
        conversationId: TEST_CONVERSATION_ID,
        toolCalls: [],
        toolOutputs: []
      });

      expect(getToolCallsByMessageId(messageId)).toEqual([]);
    });
  });
});
