import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import { sessionResolver } from '../src/middleware/session.js';
import { conversationsRouter } from '../src/routes/conversations.js';
import {
  getDb,
  upsertSession,
  createConversation,
} from '../src/db/index.js';
import {
  insertUserMessage,
  insertAssistantFinal,
} from '../src/db/messages.js';
import { createUser } from '../src/db/users.js';
import { generateAccessToken } from '../src/middleware/auth.js';
import { createEvaluation } from '../src/db/evaluations.js';
import { createChatProxyTestContext } from '../test_utils/chatProxyTestUtils.js';

const mockUser = { id: 'judge-user-1', email: 'judge@example.com' };
const sessionId = 'judge-session-1';

const { upstream, makeApp } = createChatProxyTestContext();

beforeAll(() => {
  safeTestSetup();
});

beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM evaluations; DELETE FROM messages; DELETE FROM conversations; DELETE FROM sessions; DELETE FROM users;');
});

afterAll(() => {
  const db = getDb();
  if (db) db.close();
});

function seedJudgeConversations() {
  upsertSession(sessionId, { userId: mockUser.id });

  createConversation({
    id: 'conv-primary',
    sessionId,
    userId: mockUser.id,
    title: 'Primary',
    provider_id: 'p1',
    model: 'gpt-3.5-turbo',
  });

  createConversation({
    id: 'conv-compare',
    sessionId,
    userId: mockUser.id,
    title: 'Compare',
    provider_id: 'p1',
    model: 'gpt-3.5-turbo',
    parentConversationId: 'conv-primary',
  });

  insertUserMessage({
    conversationId: 'conv-primary',
    content: 'What is the capital of France?',
    seq: 1,
    clientMessageId: 'user-1',
  });

  insertAssistantFinal({
    conversationId: 'conv-primary',
    content: 'Paris is the capital of France.',
    seq: 2,
    finishReason: 'stop',
    clientMessageId: 'assistant-a',
  });

  insertAssistantFinal({
    conversationId: 'conv-compare',
    content: 'The capital is Paris.',
    seq: 1,
    finishReason: 'stop',
    clientMessageId: 'assistant-b',
  });
}

describe('POST /v1/chat/judge', () => {
  test('streams evaluation and persists verdict', async () => {
    const app = makeApp({ mockUser });
    seedJudgeConversations();

    const res = await request(app)
      .post('/v1/chat/judge')
      .send({
        conversation_id: 'conv-primary',
        comparison_conversation_id: 'conv-compare',
        message_id: 'assistant-a',
        comparison_message_id: 'assistant-b',
        judge_model: 'gpt-3.5-turbo',
        criteria: 'Fact check',
      });

    assert.equal(res.status, 200);
    assert.ok(res.text.includes('data: '));
    assert.ok(res.text.includes('[DONE]'));

    const db = getDb();
    const rows = db.prepare('SELECT * FROM evaluations').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].model_a_message_id, 'assistant-a');
    assert.equal(rows[0].model_b_message_id, 'assistant-b');
  });

  test('returns cached evaluation without hitting upstream', async () => {
    const app = makeApp({ mockUser });
    seedJudgeConversations();

    createEvaluation({
      userId: mockUser.id,
      conversationId: 'conv-primary',
      modelAConversationId: 'conv-primary',
      modelAMessageId: 'assistant-a',
      modelBConversationId: 'conv-compare',
      modelBMessageId: 'assistant-b',
      judgeModelId: 'gpt-3.5-turbo',
      criteria: 'General check',
      scoreA: 9,
      scoreB: 7,
      winner: 'model_a',
      reasoning: 'Cached verdict',
    });

    upstream.lastChatRequestBody = null;

    const res = await request(app)
      .post('/v1/chat/judge')
      .send({
        conversation_id: 'conv-primary',
        comparison_conversation_id: 'conv-compare',
        message_id: 'assistant-a',
        comparison_message_id: 'assistant-b',
        judge_model: 'gpt-3.5-turbo',
        criteria: 'General check',
      });

    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Cached verdict'));
    assert.equal(upstream.lastChatRequestBody, null);

    const db = getDb();
    const rows = db.prepare('SELECT * FROM evaluations').all();
    assert.equal(rows.length, 1);
  });
});

describe('GET /v1/conversations/:id includes evaluations', () => {
  test('returns evaluations alongside messages', async () => {
    const app = express();
    app.use(express.json());
    app.use(sessionResolver);

    const user = createUser({
      email: 'evals@example.com',
      passwordHash: 'pw',
      displayName: 'Eval User',
    });
    const token = generateAccessToken(user);
    app.use((req, _res, next) => {
      req.headers['authorization'] = `Bearer ${token}`;
      next();
    });
    app.use(conversationsRouter);

    upsertSession(sessionId, { userId: user.id });
    createConversation({
      id: 'conv-evals',
      sessionId,
      userId: user.id,
      title: 'Eval Conversation',
      provider_id: 'p1',
      model: 'gpt-3.5-turbo',
    });
    insertUserMessage({
      conversationId: 'conv-evals',
      content: 'Hello',
      seq: 1,
      clientMessageId: 'user-2',
    });
    insertAssistantFinal({
      conversationId: 'conv-evals',
      content: 'Hi',
      seq: 2,
      finishReason: 'stop',
      clientMessageId: 'assistant-2',
    });

    createEvaluation({
      userId: user.id,
      conversationId: 'conv-evals',
      modelAConversationId: 'conv-evals',
      modelAMessageId: 'assistant-2',
      modelBConversationId: 'conv-evals',
      modelBMessageId: 'assistant-2',
      judgeModelId: 'gpt-3.5-turbo',
      criteria: 'General check',
      scoreA: 8,
      scoreB: 8,
      winner: 'tie',
      reasoning: 'Equal responses',
    });

    const res = await request(app)
      .get('/v1/conversations/conv-evals')
      .set('x-session-id', sessionId);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.evaluations));
    assert.equal(res.body.evaluations.length, 1);
    assert.equal(res.body.evaluations[0].reasoning, 'Equal responses');
  });
});
