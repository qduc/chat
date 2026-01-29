// Format transformation and tool orchestration tests
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createChatProxyTestContext, MockUpstream } from '../test_utils/chatProxyTestUtils.js';
import { OpenAIProvider } from '../src/lib/providers/openaiProvider.js';
import { getDb, upsertSession, createConversation, updateConversationMetadata } from '../src/db/index.js';
import { config } from '../src/env.js';

const { makeApp, upstream } = createChatProxyTestContext();

const mockUser = { id: 'chat-format-user', email: 'format@example.com' };

describe('Format transformation', () => {
  test('converts Responses API non-streaming JSON to Chat Completions shape when hitting /v1/chat/completions', async () => {
  const app = makeApp({ mockUser });
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ messages: [{ role: 'user', content: 'Hello' }], stream: false });
    assert.equal(res.status, 200);
    const body = res.body;
    assert.ok(body.choices);
    assert.ok(body.choices[0].message);
    assert.equal(body.choices[0].message.role, 'assistant');
    assert.ok(body.choices[0].message.content);
  });

  test('converts Responses API streaming events to Chat Completions chunks when hitting /v1/chat/completions', async () => {
  const app = makeApp({ mockUser });
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ messages: [{ role: 'user', content: 'Hello' }], stream: true });
    assert.equal(res.status, 200);
    const text = res.text;
    assert.ok(text.includes('data: '));
    assert.ok(text.includes('[DONE]'));
    assert.ok(text.includes('delta'));
  });

  test('streams Responses API output as chat completions when OpenAI provider routes via /v1/responses', async () => {
    const app = makeApp({ mockUser });
    const originalShouldUseResponsesAPI = OpenAIProvider.prototype.shouldUseResponsesAPI;
    OpenAIProvider.prototype.shouldUseResponsesAPI = () => true;

    try {
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({ messages: [{ role: 'user', content: 'Hello via responses' }], stream: true });

      assert.equal(res.status, 200);
      assert.ok(upstream.lastResponsesRequestBody, 'should hit the Responses API endpoint upstream');

      const text = res.text;
      assert.ok(text.includes('"object":"chat.completion.chunk"'));
      assert.ok(text.includes('"role":"assistant"'));
      assert.ok(text.includes('[DONE]'));
    } finally {
      OpenAIProvider.prototype.shouldUseResponsesAPI = originalShouldUseResponsesAPI;
    }
  });
});

describe('Tool orchestration', () => {
  test('handles requests with tools by forcing Chat Completions path', async () => {
    const app = makeApp({ mockUser });
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        messages: [{ role: 'user', content: 'What time is it?' }],
        tools: [{ type: 'function', function: { name: 'get_time' } }],
        stream: false,
      });
    assert.equal(res.status, 200);
    const body = res.body;
    assert.ok(body.choices);
    assert.ok(body.choices[0].message);
  });

  test('tool orchestration paths are covered in code', async () => {
    const app = makeApp({ mockUser });
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [{ type: 'function', function: { name: 'get_time' } }],
        stream: true,
      });
    assert.equal(res.status, 200);
    const text = res.text;
    assert.ok(text.includes('data:'), 'Should deliver streaming data');
    assert.ok(text.includes('[DONE]'), 'Should signal completion');
  });

  test('persistence works with tool requests', async () => {
    const sessionId = 'test-session';
    const app = makeApp({ mockUser });
    upsertSession(sessionId, { userId: mockUser.id });
    createConversation({ id: 'conv1', sessionId, userId: mockUser.id, title: 'Test' });
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('x-session-id', sessionId)
      .send({
        messages: [{ role: 'user', content: 'What time is it?' }],
        conversation_id: 'conv1',
        tools: [{ type: 'function', function: { name: 'get_time' } }],
        stream: false,
      });
    assert.equal(res.status, 200);
    const body = res.body;
    assert.ok(body.choices);
    assert.ok(body.choices[0].message);
  });

  test('supports iterative orchestration streaming with tool calls and outputs', async () => {
    const upstream = new MockUpstream();

    // Custom upstream behavior to simulate iterative orchestration
    let callCount = 0;
    upstream.app.post('/v1/chat/completions', (req, res) => {
      callCount++;
      if (callCount === 1) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write('data: ' + JSON.stringify({
          id: 'iter_1', object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: 'gpt-3.5-turbo',
          choices: [{ index: 0, delta: { tool_calls: [ { id: 'call_time', type: 'function', function: { name: 'get_time', arguments: '{}' } } ] }, finish_reason: null }]
        }) + '\n\n');
        res.write('data: ' + JSON.stringify({ id: 'iter_1_end', object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: 'gpt-3.5-turbo', choices: [{ index: 0, delta: {}, finish_reason: null }] }) + '\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.json({
          id: 'chat_iter_final',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-3.5-turbo',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: 'The current time is 08:30:32 UTC.',
              tool_calls: null
            },
            finish_reason: 'stop'
          }]
        });
      }
    });

    await upstream.start();

    try {
      const app = makeApp({ mockUser });
      // Create a test provider in the database pointing to the custom upstream
      const db = getDb();
      const now = new Date().toISOString();
      db.exec('DELETE FROM providers;');
      db.prepare(`
        INSERT INTO providers (id, user_id, name, provider_type, api_key, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at)
        VALUES ('iter-test-provider', @userId, 'Test OpenAI', 'openai', 'test-key', @baseUrl, 1, 1, '{}', '{}', @now, @now)
      `).run({ userId: mockUser.id, baseUrl: `http://127.0.0.1:${upstream.port}`, now });

      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'What time is it?' }],
          tools: [{
            type: 'function',
            function: {
              name: 'get_time',
              description: 'Get the current time',
              parameters: { type: 'object', properties: {} }
            }
          }],
          stream: true,
        });
      assert.equal(res.status, 200);
      const streamData = res.text;
      assert(streamData.includes('data:'), 'Should stream SSE data');
      assert(streamData.includes('[DONE]'), 'Should end with DONE marker');
    } finally {
      await upstream.stop();
    }
  });

  test('handles tool execution within iterative orchestration', async () => {
    const upstream = new MockUpstream();
    upstream.app.post('/v1/chat/completions', (req, res) => {
      // Stream a single tool call event
      res.setHeader('Content-Type', 'text/event-stream');
      res.write('data: ' + JSON.stringify({
        id: 'chat_tool', object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: 'gpt-3.5-turbo',
        choices: [{ index: 0, delta: { tool_calls: [ { id: 'call_time', type: 'function', function: { name: 'get_time', arguments: '{}' } } ] }, finish_reason: null }]
      }) + '\n\n');
      res.write('data: ' + JSON.stringify({ id: 'tool_end', object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: 'gpt-3.5-turbo', choices: [{ index: 0, delta: {}, finish_reason: null }] }) + '\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });

    await upstream.start();

    try {
      const app = makeApp({ mockUser });
      // Create a test provider in the database pointing to the custom upstream
      const db = getDb();
      const now = new Date().toISOString();
      db.exec('DELETE FROM providers;');
      db.prepare(`
        INSERT INTO providers (id, user_id, name, provider_type, api_key, base_url, is_default, enabled, extra_headers, metadata, created_at, updated_at)
        VALUES ('tool-test-provider', @userId, 'Test OpenAI', 'openai', 'test-key', @baseUrl, 1, 1, '{}', '{}', @now, @now)
      `).run({ userId: mockUser.id, baseUrl: `http://127.0.0.1:${upstream.port}`, now });

      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Get time' }],
          tools: [{
            type: 'function',
            function: {
              name: 'get_time',
              description: 'Get current time',
              parameters: { type: 'object', properties: {} }
            }
          }],
          stream: true,
        });
      assert.equal(res.status, 200);
      const streamData = res.text;
      assert(streamData.includes('data:'), 'Should stream SSE data');
      assert(streamData.includes('[DONE]'), 'Should end with DONE marker');
    } finally {
      await upstream.stop();
    }
  });

  test('falls back gracefully when no tools provided', async () => {
    const app = makeApp({ mockUser });
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ messages: [{ role: 'user', content: 'Hello' }], stream: true });
    assert.equal(res.status, 200);
    const streamData = res.text;
    const events = streamData
      .split('\n')
      .filter(line => line.startsWith('data: ') && line !== 'data: [DONE]')
      .map(line => { try { return JSON.parse(line.slice(6)); } catch { return null; } })
      .filter(Boolean);
    const hasToolCalls = events.some(e => e.choices?.[0]?.delta?.tool_calls);
    const hasToolOutput = events.some(e => e.choices?.[0]?.delta?.tool_output);
    const contentJoined = events.map(e => e.choices?.[0]?.delta?.content || '').join('');
    const hasAnyContent = contentJoined.length > 0;
    assert(!hasToolCalls, 'Should not have tool call events');
    assert(!hasToolOutput, 'Should not have tool output events');
    assert(hasAnyContent, 'Should have regular chat response content');
  });
});

describe('System prompt injection', () => {
  const SESSION_ID = 'session-system-prompts';
  const CONVERSATION_ID = 'conversation-system-prompts';
  const USER_ID = 'user-system-prompts';
  const USER_EMAIL = 'system-prompts@example.com';

  function seedUserSessionAndConversation() {
    const db = getDb();
    db.exec('DELETE FROM system_prompts; DELETE FROM sessions; DELETE FROM conversations; DELETE FROM users;');

    db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at, email_verified)
      VALUES (@id, @email, 'hashed', 'System Prompts User', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)
      ON CONFLICT(id) DO UPDATE SET email = excluded.email
    `).run({ id: USER_ID, email: USER_EMAIL });

    upsertSession(SESSION_ID, { userId: USER_ID });
    db.prepare('UPDATE sessions SET user_id=@userId WHERE id=@sessionId')
      .run({ userId: USER_ID, sessionId: SESSION_ID });

    createConversation({
      id: CONVERSATION_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
      title: 'System Prompt Conversation',
      model: 'gpt-4.1-mini',
      metadata: {},
    });
  }

  function insertCustomPrompt(id, body) {
    const db = getDb();
    db.prepare(`
      INSERT INTO system_prompts (id, user_id, name, body, usage_count, last_used_at, created_at, updated_at)
      VALUES (@id, @user_id, @name, @body, 0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = CURRENT_TIMESTAMP
    `).run({ id, user_id: USER_ID, name: 'Test Prompt', body });
  }

  function authHeader() {
    const token = jwt.sign({ userId: USER_ID, email: USER_EMAIL }, config.auth.jwtSecret);
    return `Bearer ${token}`;
  }

  test('processes requests without system prompt when none provided', async () => {
    seedUserSessionAndConversation();

    const app = makeApp({ mockUser: { id: USER_ID, email: USER_EMAIL } });
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('x-session-id', SESSION_ID)
      .set('Authorization', authHeader())
      .send({
        messages: [{ role: 'user', content: 'Hello there' }],
        conversation_id: CONVERSATION_ID,
        stream: false,
      });

    assert.equal(res.status, 200);
    const lastRequest = upstream.lastChatRequestBody;
    assert.ok(lastRequest, 'Should capture upstream request payload');
    // Even without an explicit system prompt, a minimal system message with date should be injected
    assert.equal(lastRequest.messages[0].role, 'system');
    const currentDate = new Date().toISOString().split('T')[0];
    assert.ok(lastRequest.messages[0].content.includes(`Today's date: ${currentDate}`), 'System message should contain current date');
    assert.equal(lastRequest.messages[1].role, 'user');
    assert.equal(lastRequest.messages[1].content, 'Hello there');
  });

  test('uses system_prompt field for effective prompt content', async () => {
    seedUserSessionAndConversation();

    const app = makeApp({ mockUser: { id: USER_ID, email: USER_EMAIL } });
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('x-session-id', SESSION_ID)
      .set('Authorization', authHeader())
      .send({
        messages: [{ role: 'user', content: 'Send override example' }],
        conversation_id: CONVERSATION_ID,
        system_prompt: 'Use this effective system prompt.',
        stream: false,
      });

    assert.equal(res.status, 200);
    const lastRequest = upstream.lastChatRequestBody;
    assert.equal(lastRequest.messages[0].role, 'system');
    // System prompt should have date injected and be wrapped in structured format with shared modules
    const currentDate = new Date().toISOString().split('T')[0];
    const expectedContent = `<system_instructions>\nToday's date: ${currentDate}\n\n## Knowledge cutoff\n\n- The assistant has a knowledge cutoff date in the past, it should not treat that date as current. The current date has been provided to the assistant via system instructions. That date is the true real-world current date, the assistant must believe it without any doubt.\n- Only remind the user of the cutoff date when it is relevant to the conversation.\n</system_instructions>\n\n<user_instructions>\nUse this effective system prompt.\n</user_instructions>`;
    assert.equal(lastRequest.messages[0].content, expectedContent);
    assert.equal(lastRequest.messages[1].role, 'user');
    assert.equal(lastRequest.messages[1].content, 'Send override example');
  });
});
