import { describe, test, beforeEach, expect } from '@jest/globals';
import { resetDbCache, getDb } from '../src/db/client.js';
import { createConversation } from '../src/db/conversations.js';
import { insertAssistantFinal, getMessagesPage } from '../src/db/messages.js';
import { insertToolCalls, insertToolOutputs, getToolCallsByMessageId, getToolOutputsByMessageId } from '../src/db/toolCalls.js';

const TEST_SESSION_ID = 'test-session-tool-persist';
const TEST_USER_ID = 'test-user-tool-persist';

describe('Tool Calls Persistence Integration', () => {
  beforeEach(() => {
    resetDbCache();
    const db = getDb();

    // Create test user and session
    db.prepare(
      `INSERT OR REPLACE INTO users (id, email, password_hash, created_at)
       VALUES (@id, @email, @password_hash, datetime('now'))`
    ).run({ id: TEST_USER_ID, email: 'test@example.com', password_hash: 'hash' });

    db.prepare(
      `INSERT OR REPLACE INTO sessions (id, user_id, created_at)
       VALUES (@id, @user_id, datetime('now'))`
    ).run({ id: TEST_SESSION_ID, user_id: TEST_USER_ID });
  });

  test('tool calls and outputs are stored separately from message content', () => {
    const conversationId = 'conv-tool-separate';
    createConversation({
      id: conversationId,
      sessionId: TEST_SESSION_ID,
      userId: TEST_USER_ID,
    });

    // Insert assistant message with ONLY the thinking text, no tool outputs
    const assistantContent = 'Let me check the time for you.';
    const result = insertAssistantFinal({
      conversationId,
      content: assistantContent,
      seq: 2,
      finishReason: 'stop',
    });

    const messageId = result.id;

    // Insert tool calls separately
    const toolCalls = [
      {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'get_time',
          arguments: '{"timezone":"UTC"}'
        }
      }
    ];

    insertToolCalls({
      messageId,
      conversationId,
      toolCalls
    });

    // Insert tool outputs separately
    const toolOutputs = [
      {
        tool_call_id: 'call_123',
        output: '{"iso":"2025-09-30T11:24:07.802Z","human":"09/30/2025, 11:24:07 UTC","timezone":"UTC"}',
        status: 'success'
      }
    ];

    insertToolOutputs({
      messageId,
      conversationId,
      toolOutputs
    });

    // Verify message content does NOT contain tool output
    const db = getDb();
    const message = db.prepare('SELECT content FROM messages WHERE id = ?').get(messageId);

    expect(message.content).toBe(assistantContent);
    expect(message.content).not.toContain('{"iso":');
    expect(message.content).not.toContain('"human":"09/30/2025');

    // Verify tool calls are retrieved separately
    const retrievedToolCalls = getToolCallsByMessageId(messageId);
    expect(retrievedToolCalls).toHaveLength(1);
    expect(retrievedToolCalls[0].tool_name).toBe('get_time');
    expect(retrievedToolCalls[0].id).toBe('call_123');

    // Verify tool outputs are retrieved separately
    const retrievedOutputs = getToolOutputsByMessageId(messageId);
    expect(retrievedOutputs).toHaveLength(1);
    expect(retrievedOutputs[0].tool_call_id).toBe('call_123');
    expect(retrievedOutputs[0].output).toBe('{"iso":"2025-09-30T11:24:07.802Z","human":"09/30/2025, 11:24:07 UTC","timezone":"UTC"}');
    expect(retrievedOutputs[0].status).toBe('success');
  });

  test('getMessagesPage properly attaches tool calls and outputs to messages', () => {
    const conversationId = 'conv-tool-page';
    createConversation({
      id: conversationId,
      sessionId: TEST_SESSION_ID,
      userId: TEST_USER_ID,
    });

    // Insert assistant message
    const assistantContent = 'The current time is available below.';
    const result = insertAssistantFinal({
      conversationId,
      content: assistantContent,
      seq: 2,
      finishReason: 'stop',
    });

    const messageId = result.id;

    // Insert tool calls
    insertToolCalls({
      messageId,
      conversationId,
      toolCalls: [{
        id: 'call_456',
        type: 'function',
        function: {
          name: 'get_time',
          arguments: '{}'
        }
      }]
    });

    // Insert tool outputs
    insertToolOutputs({
      messageId,
      conversationId,
      toolOutputs: [{
        tool_call_id: 'call_456',
        output: '14:30:00 UTC',
        status: 'success'
      }]
    });

    // Retrieve messages via getMessagesPage
    const page = getMessagesPage({ conversationId, afterSeq: 0, limit: 50 });

    expect(page.messages).toHaveLength(1);

    const message = page.messages[0];

    // Verify content is clean (no tool outputs embedded)
    expect(message.content).toBe(assistantContent);
    expect(message.content).not.toContain('14:30:00 UTC');

    // Verify tool calls are attached
    expect(message.tool_calls).toBeDefined();
    expect(message.tool_calls).toHaveLength(1);
    expect(message.tool_calls[0].id).toBe('call_456');
    expect(message.tool_calls[0].function.name).toBe('get_time');

    // Verify tool outputs are attached
    expect(message.tool_outputs).toBeDefined();
    expect(message.tool_outputs).toHaveLength(1);
    expect(message.tool_outputs[0].tool_call_id).toBe('call_456');
    expect(message.tool_outputs[0].output).toBe('14:30:00 UTC');
    expect(message.tool_outputs[0].status).toBe('success');
  });
});
