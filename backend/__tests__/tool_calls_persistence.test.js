import { describe, test, beforeEach, expect } from '@jest/globals';
import { resetDbCache, getDb } from '../src/db/client.js';
import { createConversation } from '../src/db/conversations.js';
import { insertAssistantFinal, insertUserMessage, insertToolMessage, getMessagesPage } from '../src/db/messages.js';
import { insertToolCalls, insertToolOutputs, getToolCallsByMessageId, getToolOutputsByMessageId } from '../src/db/toolCalls.js';
import { buildConversationMessagesAsync, buildConversationMessagesOptimized } from '../src/lib/toolOrchestrationUtils.js';

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

  test('buildConversationMessagesAsync reconstructs tool messages with role:tool', async () => {
    const conversationId = 'conv-tool-reconstruct';
    createConversation({
      id: conversationId,
      sessionId: TEST_SESSION_ID,
      userId: TEST_USER_ID,
    });

    // Insert initial user message
    insertUserMessage({
      conversationId,
      content: 'What is the time?',
      seq: 1,
    });

    // Insert assistant tool-call message
    const assistantToolCall = insertAssistantFinal({
      conversationId,
      content: 'Let me check the time.',
      seq: 2,
      finishReason: 'tool_calls',
    });

    insertToolCalls({
      messageId: assistantToolCall.id,
      conversationId,
      toolCalls: [{
        id: 'call_abc123',
        type: 'function',
        function: {
          name: 'get_time',
          arguments: '{"timezone":"UTC"}'
        }
      }]
    });

    // Insert tool message
    const toolMessage = insertToolMessage({
      conversationId,
      content: '{"iso":"2025-10-05T12:00:00.000Z"}',
      seq: 3,
      status: 'success',
    });

    insertToolOutputs({
      messageId: toolMessage.id,
      conversationId,
      toolOutputs: [{
        tool_call_id: 'call_abc123',
        output: '{"iso":"2025-10-05T12:00:00.000Z"}',
        status: 'success'
      }]
    });

    // Insert final assistant response
    insertAssistantFinal({
      conversationId,
      content: 'The current time is 12:00:00 UTC.',
      seq: 4,
      finishReason: 'stop',
    });

    // Insert a follow-up user message (simulating continuing the conversation)
    insertUserMessage({
      conversationId,
      content: 'Thanks, what about tomorrow?',
      seq: 5,
    });

    // Build conversation messages using buildConversationMessagesAsync
    const persistence = {
      persist: true,
      conversationId,
    };

    const messages = await buildConversationMessagesAsync({
      body: {},
      bodyIn: {},
      persistence,
      userId: TEST_USER_ID,
    });

    // Expected structure:
    // [
    //   { role: 'user', content: 'What is the time?' },
    //   { role: 'assistant', content: 'Let me check the time.', tool_calls: [...] },
    //   { role: 'tool', tool_call_id: 'call_abc123', content: '...' },
    //   { role: 'assistant', content: 'The current time is 12:00:00 UTC.' },
    //   { role: 'user', content: 'Thanks, what about tomorrow?' }
    // ]

    expect(messages).toHaveLength(5);

    // Verify user message
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('What is the time?');

    // Verify assistant message with tool_calls
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('Let me check the time.');
    expect(messages[1].tool_calls).toBeDefined();
    expect(messages[1].tool_calls).toHaveLength(1);
    expect(messages[1].tool_calls[0].id).toBe('call_abc123');
    expect(messages[1].tool_calls[0].function.name).toBe('get_time');
    expect(messages[1].tool_calls[0].function.arguments).toBe('{"timezone":"UTC"}');

    // Verify tool message (THIS IS THE FIX!)
    expect(messages[2].role).toBe('tool');
    expect(messages[2].tool_call_id).toBe('call_abc123');
    expect(messages[2].content).toBe('{"iso":"2025-10-05T12:00:00.000Z"}');

    // Verify assistant final response appears after tool output
    expect(messages[3].role).toBe('assistant');
    expect(messages[3].tool_calls).toBeUndefined();
    expect(messages[3].content).toBe('The current time is 12:00:00 UTC.');

    // Verify follow-up user message
    expect(messages[4].role).toBe('user');
    expect(messages[4].content).toBe('Thanks, what about tomorrow?');
  });

  test('buildConversationMessagesOptimized loads persisted tool history when Responses API unsupported', async () => {
    const conversationId = 'conv-tool-optimized-fallback';
    createConversation({
      id: conversationId,
      sessionId: TEST_SESSION_ID,
      userId: TEST_USER_ID,
    });

    insertUserMessage({
      conversationId,
      content: 'What date is today?',
      seq: 1,
    });

    const assistantToolCall = insertAssistantFinal({
      conversationId,
      content: '<thinking>Evaluating requested date context.</thinking><thinking>Checking calendar data.</thinking>',
      seq: 2,
      finishReason: 'tool_calls',
    });

    insertToolCalls({
      messageId: assistantToolCall.id,
      conversationId,
      toolCalls: [{
        id: 'call_calendar',
        type: 'function',
        function: {
          name: 'get_current_date',
          arguments: '{}'
        }
      }]
    });

    const toolMessage = insertToolMessage({
      conversationId,
      content: '2025-10-05',
      seq: 3,
      status: 'success',
    });

    insertToolOutputs({
      messageId: toolMessage.id,
      conversationId,
      toolOutputs: [{
        tool_call_id: 'call_calendar',
        output: '2025-10-05',
        status: 'success'
      }]
    });

    insertAssistantFinal({
      conversationId,
      content: 'The current UTC date is October 5, 2025.',
      seq: 4,
      finishReason: 'stop',
    });

    insertUserMessage({
      conversationId,
      content: 'Is it Christmas?',
      seq: 5,
    });

    const persistence = {
      persist: true,
      conversationId,
      conversationMeta: {
        metadata: {}
      }
    };

    const { messages, previousResponseId } = await buildConversationMessagesOptimized({
      body: { model: 'test-model' },
      bodyIn: {
        messages: [
          { role: 'user', content: 'Is it Christmas?' }
        ]
      },
      persistence,
      userId: TEST_USER_ID,
      provider: {
        shouldUseResponsesAPI: () => false
      }
    });

    expect(previousResponseId).toBeNull();

    expect(messages).toHaveLength(5);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('What date is today?');

    expect(messages[1].role).toBe('assistant');
    expect(Array.isArray(messages[1].tool_calls)).toBe(true);
    expect(messages[1].tool_calls).toHaveLength(1);
    expect(messages[1].tool_calls[0].id).toBe('call_calendar');
    expect(messages[1].content).toBe('<thinking>Evaluating requested date context.</thinking><thinking>Checking calendar data.</thinking>');

    expect(messages[2].role).toBe('tool');
    expect(messages[2].tool_call_id).toBe('call_calendar');
    expect(messages[2].content).toBe('2025-10-05');

    expect(messages[3].role).toBe('assistant');
    expect(messages[3].tool_calls).toBeUndefined();
    expect(messages[3].content).toBe('The current UTC date is October 5, 2025.');

    expect(messages[4].role).toBe('user');
    expect(messages[4].content).toBe('Is it Christmas?');
  });
});
