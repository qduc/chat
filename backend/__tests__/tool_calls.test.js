import assert from 'assert';
import { resetDbCache, getDb } from '../src/db/client.js';
import {
  insertToolCall,
  insertToolCalls,
  getToolCallsByMessageId,
  insertToolOutput,
  insertToolOutputs,
  getToolOutputsByToolCallId,
  getToolOutputsByMessageId,
  deleteToolCallsAndOutputsByMessageId,
} from '../src/db/toolCalls.js';
import {
  createConversation,
  insertAssistantFinal,
  getMessagesPage,
  getLastMessage,
} from '../src/db/index.js';

const TEST_SESSION_ID = 'test-session-tool-calls';
const TEST_USER_ID = 'test-user-tool-calls';

describe('Tool Calls Database', () => {
  beforeEach(() => {
    resetDbCache();
    const db = getDb();
    
    // Ensure test session exists
    db.prepare(
      `INSERT OR REPLACE INTO sessions (id, user_id, created_at)
       VALUES (@id, @user_id, datetime('now'))`
    ).run({ id: TEST_SESSION_ID, user_id: TEST_USER_ID });
  });

  describe('insertToolCall', () => {
    test('should insert a single tool call', () => {
      const conversationId = 'conv-tool-call-1';
      createConversation({
        id: conversationId,
        sessionId: TEST_SESSION_ID,
        userId: TEST_USER_ID,
      });

      const result = insertAssistantFinal({
        conversationId,
        content: 'Let me check the time',
        seq: 1,
      });

      const toolCall = insertToolCall({
        id: 'call_123',
        messageId: result.id,
        conversationId,
        callIndex: 0,
        toolName: 'get_time',
        arguments: '{"timezone":"UTC"}',
        textOffset: 10,
      });

      assert.strictEqual(toolCall.id, 'call_123');
      assert.strictEqual(toolCall.toolName, 'get_time');
      assert.strictEqual(toolCall.messageId, result.id);
    });

    test('should handle object arguments', () => {
      const conversationId = 'conv-tool-call-2';
      createConversation({
        id: conversationId,
        sessionId: TEST_SESSION_ID,
        userId: TEST_USER_ID,
      });

      const result = insertAssistantFinal({
        conversationId,
        content: 'Searching...',
        seq: 1,
      });

      const toolCall = insertToolCall({
        id: 'call_456',
        messageId: result.id,
        conversationId,
        callIndex: 0,
        toolName: 'web_search',
        arguments: { query: 'test search', max_results: 5 },
      });

      assert.strictEqual(toolCall.arguments, '{"query":"test search","max_results":5}');
    });
  });

  describe('insertToolCalls', () => {
    test('should insert multiple tool calls', () => {
      const conversationId = 'conv-tool-calls-batch';
      createConversation({
        id: conversationId,
        sessionId: TEST_SESSION_ID,
        userId: TEST_USER_ID,
      });

      const result = insertAssistantFinal({
        conversationId,
        content: 'Let me use multiple tools',
        seq: 1,
      });

      const toolCalls = [
        {
          id: 'call_1',
          index: 0,
          function: { name: 'get_time', arguments: '{}' },
        },
        {
          id: 'call_2',
          index: 1,
          function: { name: 'web_search', arguments: '{"query":"test"}' },
        },
      ];

      const results = insertToolCalls({
        messageId: result.id,
        conversationId,
        toolCalls,
      });

      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0].toolName, 'get_time');
      assert.strictEqual(results[1].toolName, 'web_search');
    });

    test('should handle empty array', () => {
      const conversationId = 'conv-empty-tools';
      createConversation({
        id: conversationId,
        sessionId: TEST_SESSION_ID,
        userId: TEST_USER_ID,
      });

      const result = insertAssistantFinal({
        conversationId,
        content: 'No tools',
        seq: 1,
      });

      const results = insertToolCalls({
        messageId: result.id,
        conversationId,
        toolCalls: [],
      });

      assert.strictEqual(results.length, 0);
    });
  });

  describe('getToolCallsByMessageId', () => {
    test('should retrieve tool calls for a message', () => {
      const conversationId = 'conv-get-tools';
      createConversation({
        id: conversationId,
        sessionId: TEST_SESSION_ID,
        userId: TEST_USER_ID,
      });

      const result = insertAssistantFinal({
        conversationId,
        content: 'Using tools',
        seq: 1,
      });

      insertToolCalls({
        messageId: result.id,
        conversationId,
        toolCalls: [
          { id: 'call_a', function: { name: 'tool_a', arguments: '{}' } },
          { id: 'call_b', function: { name: 'tool_b', arguments: '{}' } },
        ],
      });

      const toolCalls = getToolCallsByMessageId(result.id);
      assert.strictEqual(toolCalls.length, 2);
      assert.strictEqual(toolCalls[0].tool_name, 'tool_a');
      assert.strictEqual(toolCalls[1].tool_name, 'tool_b');
    });
  });

  describe('insertToolOutput', () => {
    test('should insert a tool output', () => {
      const conversationId = 'conv-tool-output-1';
      createConversation({
        id: conversationId,
        sessionId: TEST_SESSION_ID,
        userId: TEST_USER_ID,
      });

      const msgResult = insertAssistantFinal({
        conversationId,
        content: 'Getting time',
        seq: 1,
      });

      insertToolCall({
        id: 'call_time_1',
        messageId: msgResult.id,
        conversationId,
        callIndex: 0,
        toolName: 'get_time',
        arguments: '{}',
      });

      const output = insertToolOutput({
        toolCallId: 'call_time_1',
        messageId: msgResult.id,
        conversationId,
        output: '{"time":"14:30:00"}',
        status: 'success',
      });

      assert.strictEqual(output.toolCallId, 'call_time_1');
      assert.strictEqual(output.status, 'success');
    });

    test('should handle error status', () => {
      const conversationId = 'conv-tool-error';
      createConversation({
        id: conversationId,
        sessionId: TEST_SESSION_ID,
        userId: TEST_USER_ID,
      });

      const msgResult = insertAssistantFinal({
        conversationId,
        content: 'Tool failed',
        seq: 1,
      });

      insertToolCall({
        id: 'call_fail',
        messageId: msgResult.id,
        conversationId,
        callIndex: 0,
        toolName: 'failing_tool',
        arguments: '{}',
      });

      const output = insertToolOutput({
        toolCallId: 'call_fail',
        messageId: msgResult.id,
        conversationId,
        output: 'Tool execution failed: timeout',
        status: 'error',
      });

      assert.strictEqual(output.status, 'error');
    });
  });

  describe('getToolOutputsByToolCallId', () => {
    test('should retrieve outputs for a tool call', () => {
      const conversationId = 'conv-get-outputs';
      createConversation({
        id: conversationId,
        sessionId: TEST_SESSION_ID,
        userId: TEST_USER_ID,
      });

      const msgResult = insertAssistantFinal({
        conversationId,
        content: 'Tool execution',
        seq: 1,
      });

      insertToolCall({
        id: 'call_multi_out',
        messageId: msgResult.id,
        conversationId,
        callIndex: 0,
        toolName: 'test_tool',
        arguments: '{}',
      });

      insertToolOutput({
        toolCallId: 'call_multi_out',
        messageId: msgResult.id,
        conversationId,
        output: 'Result 1',
        status: 'success',
      });

      const outputs = getToolOutputsByToolCallId('call_multi_out');
      assert.strictEqual(outputs.length, 1);
      assert.strictEqual(outputs[0].output, 'Result 1');
    });
  });

  describe('getMessagesPage with tool calls', () => {
    test('should include tool calls and outputs in messages', () => {
      const conversationId = 'conv-page-tools';
      createConversation({
        id: conversationId,
        sessionId: TEST_SESSION_ID,
        userId: TEST_USER_ID,
      });

      const msgResult = insertAssistantFinal({
        conversationId,
        content: 'Using get_time',
        seq: 1,
      });

      insertToolCalls({
        messageId: msgResult.id,
        conversationId,
        toolCalls: [
          { id: 'call_page_1', function: { name: 'get_time', arguments: '{}' } },
        ],
      });

      insertToolOutputs({
        messageId: msgResult.id,
        conversationId,
        toolOutputs: [
          { tool_call_id: 'call_page_1', output: '15:45:00', status: 'success' },
        ],
      });

      const page = getMessagesPage({ conversationId, afterSeq: 0, limit: 50 });
      
      assert.strictEqual(page.messages.length, 1);
      assert.ok(Array.isArray(page.messages[0].tool_calls));
      assert.strictEqual(page.messages[0].tool_calls.length, 1);
      assert.strictEqual(page.messages[0].tool_calls[0].function.name, 'get_time');
      
      assert.ok(Array.isArray(page.messages[0].tool_outputs));
      assert.strictEqual(page.messages[0].tool_outputs.length, 1);
      assert.strictEqual(page.messages[0].tool_outputs[0].output, '15:45:00');
    });
  });

  describe('getLastMessage with tool calls', () => {
    test('should include tool calls and outputs', () => {
      const conversationId = 'conv-last-tools';
      createConversation({
        id: conversationId,
        sessionId: TEST_SESSION_ID,
        userId: TEST_USER_ID,
      });

      const msgResult = insertAssistantFinal({
        conversationId,
        content: 'Last message with tools',
        seq: 1,
      });

      insertToolCalls({
        messageId: msgResult.id,
        conversationId,
        toolCalls: [
          { id: 'call_last', function: { name: 'web_search', arguments: '{"query":"test"}' } },
        ],
      });

      insertToolOutputs({
        messageId: msgResult.id,
        conversationId,
        toolOutputs: [
          { tool_call_id: 'call_last', output: 'Search results...', status: 'success' },
        ],
      });

      const message = getLastMessage({ conversationId });
      
      assert.ok(message);
      assert.ok(Array.isArray(message.tool_calls));
      assert.strictEqual(message.tool_calls[0].function.name, 'web_search');
      assert.ok(Array.isArray(message.tool_outputs));
      assert.strictEqual(message.tool_outputs[0].output, 'Search results...');
    });
  });

  describe('deleteToolCallsAndOutputsByMessageId', () => {
    test('should delete tool calls and outputs', () => {
      const conversationId = 'conv-delete-tools';
      createConversation({
        id: conversationId,
        sessionId: TEST_SESSION_ID,
        userId: TEST_USER_ID,
      });

      const msgResult = insertAssistantFinal({
        conversationId,
        content: 'To be deleted',
        seq: 1,
      });

      insertToolCalls({
        messageId: msgResult.id,
        conversationId,
        toolCalls: [
          { id: 'call_del', function: { name: 'test', arguments: '{}' } },
        ],
      });

      insertToolOutputs({
        messageId: msgResult.id,
        conversationId,
        toolOutputs: [
          { tool_call_id: 'call_del', output: 'result', status: 'success' },
        ],
      });

      const result = deleteToolCallsAndOutputsByMessageId(msgResult.id);
      
      assert.strictEqual(result.toolCallsDeleted, 1);
      assert.strictEqual(result.toolOutputsDeleted, 1);

      const toolCalls = getToolCallsByMessageId(msgResult.id);
      const outputs = getToolOutputsByMessageId(msgResult.id);
      
      assert.strictEqual(toolCalls.length, 0);
      assert.strictEqual(outputs.length, 0);
    });
  });

  describe('CASCADE deletion', () => {
    test('should cascade delete tool calls and outputs when message is deleted', () => {
      const conversationId = 'conv-cascade';
      const db = getDb();
      
      createConversation({
        id: conversationId,
        sessionId: TEST_SESSION_ID,
        userId: TEST_USER_ID,
      });

      const msgResult = insertAssistantFinal({
        conversationId,
        content: 'Message to cascade',
        seq: 1,
      });

      insertToolCalls({
        messageId: msgResult.id,
        conversationId,
        toolCalls: [
          { id: 'call_cascade', function: { name: 'test', arguments: '{}' } },
        ],
      });

      insertToolOutputs({
        messageId: msgResult.id,
        conversationId,
        toolOutputs: [
          { tool_call_id: 'call_cascade', output: 'result', status: 'success' },
        ],
      });

      // Delete the message
      db.prepare('DELETE FROM messages WHERE id = @id').run({ id: msgResult.id });

      // Tool calls and outputs should be cascade deleted
      const toolCalls = getToolCallsByMessageId(msgResult.id);
      const outputs = getToolOutputsByMessageId(msgResult.id);
      
      assert.strictEqual(toolCalls.length, 0);
      assert.strictEqual(outputs.length, 0);
    });
  });
});
