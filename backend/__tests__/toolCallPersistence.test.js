/**
 * Unit tests for ToolCallPersistence class
 * Tests all static methods for saving and loading tool calls and outputs
 */

import { beforeAll, afterAll, beforeEach, describe, expect, test, jest } from '@jest/globals';
import { config } from '../src/env.js';
import { getDb, resetDbCache } from '../src/db/index.js';
import { ToolCallPersistence } from '../src/lib/persistence/ToolCallPersistence.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import { ensureTestUser, ensureTestConversation, TEST_USER_ID } from './helpers/systemPromptsTestUtils.js';
import * as toolCallsDb from '../src/db/toolCalls.js';
import { logger } from '../src/logger.js';

const TEST_CONVERSATION_ID = 'test-conversation';
let testMessageId;
let messageSeq = 0; // Counter for unique seq values

beforeAll(() => {
  safeTestSetup();
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  getDb();
  ensureTestUser();
  ensureTestConversation(TEST_CONVERSATION_ID);

  // Mock logger to suppress error logs during testing
  jest.spyOn(logger, 'error').mockImplementation(() => {});
});

// Helper to create a test message
function createTestMessage(conversationId = TEST_CONVERSATION_ID, role = 'assistant') {
  const db = getDb();
  messageSeq++;
  const result = db.prepare(
    `INSERT INTO messages (conversation_id, role, content, seq, created_at)
     VALUES (@conversationId, @role, @content, @seq, CURRENT_TIMESTAMP)`
  ).run({
    conversationId,
    role,
    content: 'Test message content',
    seq: messageSeq
  });
  return result.lastInsertRowid;
}

beforeEach(() => {
  const db = getDb();

  // Clean up tool-related tables
  db.prepare('DELETE FROM tool_outputs').run();
  db.prepare('DELETE FROM tool_calls').run();
  db.prepare('DELETE FROM messages').run();
  db.prepare('DELETE FROM conversations').run();

  // Recreate test user and conversation
  ensureTestUser();
  ensureTestConversation(TEST_CONVERSATION_ID);

  // Reset message seq counter
  messageSeq = 0;

  // Create a test message
  testMessageId = createTestMessage();
});

afterAll(() => {
  resetDbCache();
});

describe('ToolCallPersistence.saveToolCalls', () => {
  test('saves valid tool calls and returns inserted records', () => {
    const toolCalls = [
      {
        id: 'call_123',
        type: 'function',
        index: 0,
        function: {
          name: 'get_weather',
          arguments: '{"location":"Paris"}'
        }
      },
      {
        id: 'call_456',
        type: 'function',
        index: 1,
        function: {
          name: 'search_web',
          arguments: '{"query":"AI news"}'
        }
      }
    ];

    const result = ToolCallPersistence.saveToolCalls({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 'call_123',
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolName: 'get_weather'
    });
    expect(result[1]).toMatchObject({
      id: 'call_456',
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolName: 'search_web'
    });
  });

  test('returns empty array when messageId is missing', () => {
    const result = ToolCallPersistence.saveToolCalls({
      messageId: null,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls: [{ id: 'call_123', function: { name: 'test' } }]
    });

    expect(result).toEqual([]);
  });

  test('returns empty array when conversationId is missing', () => {
    const result = ToolCallPersistence.saveToolCalls({
      messageId: testMessageId,
      conversationId: null,
      toolCalls: [{ id: 'call_123', function: { name: 'test' } }]
    });

    expect(result).toEqual([]);
  });

  test('returns empty array when toolCalls is not an array', () => {
    const result = ToolCallPersistence.saveToolCalls({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls: null
    });

    expect(result).toEqual([]);
  });

  test('returns empty array when toolCalls array is empty', () => {
    const result = ToolCallPersistence.saveToolCalls({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls: []
    });

    expect(result).toEqual([]);
  });

  test('handles tool calls with object arguments', () => {
    const toolCalls = [
      {
        id: 'call_obj',
        function: {
          name: 'test_tool',
          arguments: { key: 'value' } // Object instead of string
        }
      }
    ];

    const result = ToolCallPersistence.saveToolCalls({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls
    });

    expect(result).toHaveLength(1);
    expect(result[0].arguments).toBe('{"key":"value"}');
  });
});

describe('ToolCallPersistence.saveToolOutputs', () => {
  test('saves valid tool outputs and returns inserted records', () => {
    // First create tool calls
    ToolCallPersistence.saveToolCalls({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls: [
        { id: 'call_123', function: { name: 'get_weather', arguments: '{}' } },
        { id: 'call_456', function: { name: 'search_web', arguments: '{}' } }
      ]
    });

    const toolOutputs = [
      {
        tool_call_id: 'call_123',
        output: 'Weather in Paris: 20°C, sunny',
        status: 'success'
      },
      {
        tool_call_id: 'call_456',
        output: 'Search results: ...',
        status: 'success'
      }
    ];

    const result = ToolCallPersistence.saveToolOutputs({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolOutputs
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      toolCallId: 'call_123',
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      status: 'success'
    });
    expect(result[1]).toMatchObject({
      toolCallId: 'call_456',
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      status: 'success'
    });
  });

  test('returns empty array when messageId is missing', () => {
    const result = ToolCallPersistence.saveToolOutputs({
      messageId: null,
      conversationId: TEST_CONVERSATION_ID,
      toolOutputs: [{ tool_call_id: 'call_123', output: 'test' }]
    });

    expect(result).toEqual([]);
  });

  test('returns empty array when conversationId is missing', () => {
    const result = ToolCallPersistence.saveToolOutputs({
      messageId: testMessageId,
      conversationId: null,
      toolOutputs: [{ tool_call_id: 'call_123', output: 'test' }]
    });

    expect(result).toEqual([]);
  });

  test('returns empty array when toolOutputs is not an array', () => {
    const result = ToolCallPersistence.saveToolOutputs({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolOutputs: 'not an array'
    });

    expect(result).toEqual([]);
  });

  test('returns empty array when toolOutputs array is empty', () => {
    const result = ToolCallPersistence.saveToolOutputs({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolOutputs: []
    });

    expect(result).toEqual([]);
  });

  test('defaults to success status when not provided', () => {
    // First create tool call
    ToolCallPersistence.saveToolCalls({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls: [{ id: 'call_default', function: { name: 'test', arguments: '{}' } }]
    });

    const toolOutputs = [
      {
        tool_call_id: 'call_default',
        output: 'Result'
      }
    ];

    const result = ToolCallPersistence.saveToolOutputs({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolOutputs
    });

    expect(result[0].status).toBe('success');
  });

  test('handles object outputs by stringifying', () => {
    // First create tool call
    ToolCallPersistence.saveToolCalls({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls: [{ id: 'call_obj', function: { name: 'test', arguments: '{}' } }]
    });

    const toolOutputs = [
      {
        tool_call_id: 'call_obj',
        output: { result: 'success', data: [1, 2, 3] },
        status: 'success'
      }
    ];

    const result = ToolCallPersistence.saveToolOutputs({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolOutputs
    });

    expect(result[0].output).toBe('{"result":"success","data":[1,2,3]}');
  });
});

describe('ToolCallPersistence.loadToolCalls', () => {
  beforeEach(() => {
    // Seed some tool calls for loading tests
    toolCallsDb.insertToolCalls({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls: [
        {
          id: 'call_load_1',
          index: 0,
          function: {
            name: 'weather_tool',
            arguments: '{"city":"Tokyo"}'
          },
          textOffset: 10
        },
        {
          id: 'call_load_2',
          index: 1,
          function: {
            name: 'calculator',
            arguments: '{"expr":"10*5"}'
          }
        }
      ]
    });
  });

  test('loads and transforms tool calls to OpenAI format', () => {
    const result = ToolCallPersistence.loadToolCalls(testMessageId);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'call_load_1',
      type: 'function',
      index: 0,
      function: {
        name: 'weather_tool',
        arguments: '{"city":"Tokyo"}'
      },
      textOffset: 10
    });
    expect(result[1]).toEqual({
      id: 'call_load_2',
      type: 'function',
      index: 1,
      function: {
        name: 'calculator',
        arguments: '{"expr":"10*5"}'
      },
      textOffset: null
    });
  });

  test('returns empty array when messageId is missing', () => {
    const result = ToolCallPersistence.loadToolCalls(null);
    expect(result).toEqual([]);
  });

  test('returns empty array when no tool calls exist for message', () => {
    const emptyMessageId = createTestMessage(TEST_CONVERSATION_ID, 'user');

    const result = ToolCallPersistence.loadToolCalls(emptyMessageId);
    expect(result).toEqual([]);
  });

  test('properly orders tool calls by call_index', () => {
    // Insert calls in reverse order to test ordering
    const orderedMsgId = createTestMessage();

    toolCallsDb.insertToolCalls({
      messageId: orderedMsgId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls: [
        { id: 'call_3', index: 2, function: { name: 'third', arguments: '{}' } },
        { id: 'call_1', index: 0, function: { name: 'first', arguments: '{}' } },
        { id: 'call_2', index: 1, function: { name: 'second', arguments: '{}' } }
      ]
    });

    const result = ToolCallPersistence.loadToolCalls(orderedMsgId);

    expect(result).toHaveLength(3);
    expect(result[0].function.name).toBe('first');
    expect(result[1].function.name).toBe('second');
    expect(result[2].function.name).toBe('third');
  });
});

describe('ToolCallPersistence.loadToolOutputs', () => {
  beforeEach(() => {
    // Seed some tool calls first
    toolCallsDb.insertToolCalls({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls: [
        { id: 'call_out_1', function: { name: 'weather', arguments: '{}' } },
        { id: 'call_out_2', function: { name: 'search', arguments: '{}' } }
      ]
    });

    // Seed some tool outputs for loading tests
    toolCallsDb.insertToolOutputs({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolOutputs: [
        {
          tool_call_id: 'call_out_1',
          output: 'Temperature: 25°C',
          status: 'success'
        },
        {
          tool_call_id: 'call_out_2',
          output: 'Error: API unavailable',
          status: 'error'
        }
      ]
    });
  });

  test('loads and transforms tool outputs', () => {
    const result = ToolCallPersistence.loadToolOutputs(testMessageId);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      tool_call_id: 'call_out_1',
      output: 'Temperature: 25°C',
      status: 'success'
    });
    expect(result[1]).toEqual({
      tool_call_id: 'call_out_2',
      output: 'Error: API unavailable',
      status: 'error'
    });
  });

  test('returns empty array when messageId is missing', () => {
    const result = ToolCallPersistence.loadToolOutputs(null);
    expect(result).toEqual([]);
  });

  test('returns empty array when no outputs exist for message', () => {
    const emptyMessageId = createTestMessage(TEST_CONVERSATION_ID, 'user');

    const result = ToolCallPersistence.loadToolOutputs(emptyMessageId);
    expect(result).toEqual([]);
  });

  test('handles multiple outputs with same tool_call_id', () => {
    const multiMsgId = createTestMessage();

    // First create tool call
    toolCallsDb.insertToolCalls({
      messageId: multiMsgId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls: [{ id: 'call_same', function: { name: 'test', arguments: '{}' } }]
    });

    toolCallsDb.insertToolOutputs({
      messageId: multiMsgId,
      conversationId: TEST_CONVERSATION_ID,
      toolOutputs: [
        { tool_call_id: 'call_same', output: 'First output', status: 'success' },
        { tool_call_id: 'call_same', output: 'Second output', status: 'success' }
      ]
    });

    const result = ToolCallPersistence.loadToolOutputs(multiMsgId);

    expect(result).toHaveLength(2);
    expect(result[0].tool_call_id).toBe('call_same');
    expect(result[1].tool_call_id).toBe('call_same');
  });
});

describe('ToolCallPersistence.saveToolCallsAndOutputs', () => {
  test('saves both tool calls and outputs successfully', () => {
    const toolCalls = [
      {
        id: 'call_combo_1',
        function: {
          name: 'combo_tool',
          arguments: '{"input":"test"}'
        }
      }
    ];

    const toolOutputs = [
      {
        tool_call_id: 'call_combo_1',
        output: 'Combo result',
        status: 'success'
      }
    ];

    const result = ToolCallPersistence.saveToolCallsAndOutputs({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls,
      toolOutputs
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolOutputs).toHaveLength(1);
    expect(result.toolCalls[0].toolName).toBe('combo_tool');
    expect(result.toolOutputs[0].toolCallId).toBe('call_combo_1');
  });

  test('saves only tool calls when outputs are empty', () => {
    const toolCalls = [
      {
        id: 'call_only',
        function: {
          name: 'only_call',
          arguments: '{}'
        }
      }
    ];

    const result = ToolCallPersistence.saveToolCallsAndOutputs({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls,
      toolOutputs: []
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolOutputs).toEqual([]);
  });

  test('saves only outputs when tool calls are empty', () => {
    // First create a tool call
    ToolCallPersistence.saveToolCalls({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls: [{ id: 'call_existing', function: { name: 'test', arguments: '{}' } }]
    });

    const toolOutputs = [
      {
        tool_call_id: 'call_existing',
        output: 'Output only',
        status: 'success'
      }
    ];

    const result = ToolCallPersistence.saveToolCallsAndOutputs({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls: [],
      toolOutputs
    });

    expect(result.toolCalls).toEqual([]);
    expect(result.toolOutputs).toHaveLength(1);
  });

  test('returns empty arrays when no data provided', () => {
    const result = ToolCallPersistence.saveToolCallsAndOutputs({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls: [],
      toolOutputs: []
    });

    expect(result.toolCalls).toEqual([]);
    expect(result.toolOutputs).toEqual([]);
  });

  test('handles validation errors from individual methods', () => {
    const result = ToolCallPersistence.saveToolCallsAndOutputs({
      messageId: null, // Invalid messageId
      conversationId: TEST_CONVERSATION_ID,
      toolCalls: [{ id: 'call_123', function: { name: 'test' } }],
      toolOutputs: [{ tool_call_id: 'call_123', output: 'test' }]
    });

    // Both should return empty arrays due to validation failure
    expect(result.toolCalls).toEqual([]);
    expect(result.toolOutputs).toEqual([]);
  });

  test('saves multiple tool calls and outputs in a batch', () => {
    const toolCalls = [
      { id: 'call_batch_1', function: { name: 'tool1', arguments: '{}' } },
      { id: 'call_batch_2', function: { name: 'tool2', arguments: '{}' } },
      { id: 'call_batch_3', function: { name: 'tool3', arguments: '{}' } }
    ];

    const toolOutputs = [
      { tool_call_id: 'call_batch_1', output: 'Output 1' },
      { tool_call_id: 'call_batch_2', output: 'Output 2' },
      { tool_call_id: 'call_batch_3', output: 'Output 3' }
    ];

    const result = ToolCallPersistence.saveToolCallsAndOutputs({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls,
      toolOutputs
    });

    expect(result.toolCalls).toHaveLength(3);
    expect(result.toolOutputs).toHaveLength(3);
  });
});

describe('ToolCallPersistence integration scenarios', () => {
  test('complete workflow: save calls, save outputs, then load both', () => {
    // Step 1: Save tool calls
    const toolCalls = [
      {
        id: 'call_workflow',
        index: 0,
        function: {
          name: 'workflow_tool',
          arguments: '{"step":"1"}'
        }
      }
    ];

    ToolCallPersistence.saveToolCalls({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls
    });

    // Step 2: Save tool outputs
    const toolOutputs = [
      {
        tool_call_id: 'call_workflow',
        output: 'Step 1 complete',
        status: 'success'
      }
    ];

    ToolCallPersistence.saveToolOutputs({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolOutputs
    });

    // Step 3: Load both
    const loadedCalls = ToolCallPersistence.loadToolCalls(testMessageId);
    const loadedOutputs = ToolCallPersistence.loadToolOutputs(testMessageId);

    expect(loadedCalls).toHaveLength(1);
    expect(loadedOutputs).toHaveLength(1);
    expect(loadedCalls[0].id).toBe('call_workflow');
    expect(loadedOutputs[0].tool_call_id).toBe('call_workflow');
  });

  test('handles multiple messages with different tool calls', () => {
    // Create second message
    const msg2Id = createTestMessage();

    // Save tool calls for first message
    ToolCallPersistence.saveToolCalls({
      messageId: testMessageId,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls: [
        { id: 'call_msg1', function: { name: 'tool_msg1', arguments: '{}' } }
      ]
    });

    // Save tool calls for second message
    ToolCallPersistence.saveToolCalls({
      messageId: msg2Id,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls: [
        { id: 'call_msg2', function: { name: 'tool_msg2', arguments: '{}' } }
      ]
    });

    // Load and verify isolation
    const msg1Calls = ToolCallPersistence.loadToolCalls(testMessageId);
    const msg2Calls = ToolCallPersistence.loadToolCalls(msg2Id);

    expect(msg1Calls).toHaveLength(1);
    expect(msg2Calls).toHaveLength(1);
    expect(msg1Calls[0].id).toBe('call_msg1');
    expect(msg2Calls[0].id).toBe('call_msg2');
  });

  test('empty validation returns do not affect database state', () => {
    const initialCalls = ToolCallPersistence.loadToolCalls(testMessageId);

    // Try to save with invalid parameters
    ToolCallPersistence.saveToolCalls({
      messageId: null,
      conversationId: TEST_CONVERSATION_ID,
      toolCalls: [{ id: 'should_not_save', function: { name: 'test' } }]
    });

    // Verify no changes
    const afterCalls = ToolCallPersistence.loadToolCalls(testMessageId);
    expect(afterCalls).toEqual(initialCalls);
  });
});
