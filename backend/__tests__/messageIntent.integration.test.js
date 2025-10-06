import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/app.js';
import { getDb, closeDb } from '../src/db/client.js';
import { createConversation } from '../src/db/conversations.js';
import { insertUserMessage, insertAssistantFinal } from '../src/db/messages.js';
import { v4 as uuidv4 } from 'uuid';

// Mock user for testing
const testUser = {
  id: 'test-user-intent-' + uuidv4(),
  email: 'intent-test@example.com'
};

// Helper to create auth token
function createTestToken(userId) {
  // In real tests, this would create a proper JWT
  // For now, we'll use a simple mock
  return `Bearer test-token-${userId}`;
}

describe('Message Intent Schema Integration', () => {
  let db;
  let authToken;

  beforeAll(() => {
    db = getDb();
    authToken = createTestToken(testUser.id);
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    // Clean up test data before each test
    db.prepare('DELETE FROM messages WHERE conversation_id LIKE ?').run('test-conv-%');
    db.prepare('DELETE FROM conversations WHERE id LIKE ?').run('test-conv-%');
  });

  describe('POST /v1/chat/completions with append_message intent', () => {
    test('accepts new conversation with intent envelope', async () => {
      const intent = {
        type: 'append_message',
        client_operation: 'test-op-001',
        messages: [{
          role: 'user',
          content: 'Hello, AI!'
        }],
        completion: {
          model: 'gpt-3.5-turbo',
          max_tokens: 100
        }
      };

      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', authToken)
        .send({ intent })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        client_operation: 'test-op-001',
        operations: {
          inserted: expect.any(Array),
          updated: expect.any(Array),
          deleted: expect.any(Array)
        }
      });

      expect(response.body.conversation_id).toBeDefined();
      expect(response.body.operations.inserted.length).toBeGreaterThan(0);
    });

    test('accepts append to existing conversation with valid intent', async () => {
      // Create a test conversation with messages
      const conversationId = 'test-conv-' + uuidv4();
      createConversation({
        id: conversationId,
        userId: testUser.id,
        sessionId: 'test-session',
        title: 'Test Conversation'
      });

      const userMsg = insertUserMessage({
        conversationId,
        content: 'First message',
        seq: 1
      });

      insertAssistantFinal({
        conversationId,
        content: 'First response',
        seq: 2,
        responseId: 'resp-001'
      });

      // Append with intent
      const intent = {
        type: 'append_message',
        client_operation: 'test-op-002',
        conversation_id: conversationId,
        after_message_id: userMsg.id,
        after_seq: 2,
        messages: [{
          role: 'user',
          content: 'Second message'
        }],
        completion: {
          model: 'gpt-3.5-turbo'
        }
      };

      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', authToken)
        .send({ intent })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        conversation_id: conversationId,
        client_operation: 'test-op-002'
      });
    });

    test('rejects append with conversation_id but missing after_message_id', async () => {
      const conversationId = 'test-conv-' + uuidv4();
      createConversation({
        id: conversationId,
        userId: testUser.id,
        sessionId: 'test-session',
        title: 'Test'
      });

      const intent = {
        type: 'append_message',
        client_operation: 'test-op-003',
        conversation_id: conversationId,
        messages: [{
          role: 'user',
          content: 'Hello'
        }],
        completion: {}
      };

      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', authToken)
        .send({ intent })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'validation_error',
        error_code: 'missing_required_field',
        client_operation: 'test-op-003'
      });
    });

    test('rejects append with seq_mismatch (optimistic lock failure)', async () => {
      const conversationId = 'test-conv-' + uuidv4();
      createConversation({
        id: conversationId,
        userId: testUser.id,
        sessionId: 'test-session',
        title: 'Test'
      });

      const userMsg = insertUserMessage({
        conversationId,
        content: 'Message',
        seq: 1
      });

      // Intent with wrong seq
      const intent = {
        type: 'append_message',
        client_operation: 'test-op-004',
        conversation_id: conversationId,
        after_message_id: userMsg.id,
        after_seq: 999, // Wrong seq
        messages: [{
          role: 'user',
          content: 'Next message'
        }],
        completion: {}
      };

      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', authToken)
        .send({ intent })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'validation_error',
        error_code: 'seq_mismatch',
        client_operation: 'test-op-004',
        details: {
          field: 'after_seq',
          expected: 1,
          actual: 999
        }
      });
    });

    test('rejects append to non-existent conversation', async () => {
      const intent = {
        type: 'append_message',
        client_operation: 'test-op-005',
        conversation_id: 'non-existent-conv',
        after_message_id: uuidv4(),
        after_seq: 1,
        messages: [{
          role: 'user',
          content: 'Hello'
        }],
        completion: {}
      };

      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', authToken)
        .send({ intent })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'validation_error',
        error_code: 'conversation_not_found',
        client_operation: 'test-op-005'
      });
    });

    test('maintains backward compatibility without intent envelope', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', authToken)
        .send({
          messages: [{
            role: 'user',
            content: 'Hello without intent'
          }],
          model: 'gpt-3.5-turbo'
        })
        .expect(200);

      // Response should be in legacy format (no intent fields)
      expect(response.body.success).toBeUndefined();
      expect(response.body.client_operation).toBeUndefined();
    });
  });

  describe('PUT /v1/conversations/:id/messages/:messageId/edit with edit_message intent', () => {
    test('accepts edit with valid intent envelope', async () => {
      const conversationId = 'test-conv-' + uuidv4();
      createConversation({
        id: conversationId,
        userId: testUser.id,
        sessionId: 'test-session',
        title: 'Test'
      });

      const userMsg = insertUserMessage({
        conversationId,
        content: 'Original message',
        seq: 1
      });

      insertAssistantFinal({
        conversationId,
        content: 'Response',
        seq: 2,
        responseId: 'resp-001'
      });

      const intent = {
        type: 'edit_message',
        client_operation: 'test-op-101',
        message_id: userMsg.id,
        expected_seq: 1,
        content: 'Edited message'
      };

      const response = await request(app)
        .put(`/v1/conversations/${conversationId}/messages/${userMsg.id}/edit`)
        .set('Authorization', authToken)
        .send({ intent })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        conversation_id: conversationId,
        client_operation: 'test-op-101',
        operations: {
          inserted: [],
          updated: expect.arrayContaining([
            expect.objectContaining({
              id: userMsg.id,
              seq: 1,
              role: 'user'
            })
          ]),
          deleted: expect.arrayContaining([
            expect.objectContaining({
              seq: 2,
              role: 'assistant'
            })
          ])
        },
        fork_conversation_id: expect.any(String)
      });
    });

    test('rejects edit with seq_mismatch', async () => {
      const conversationId = 'test-conv-' + uuidv4();
      createConversation({
        id: conversationId,
        userId: testUser.id,
        sessionId: 'test-session',
        title: 'Test'
      });

      const userMsg = insertUserMessage({
        conversationId,
        content: 'Message',
        seq: 1
      });

      const intent = {
        type: 'edit_message',
        client_operation: 'test-op-102',
        message_id: userMsg.id,
        expected_seq: 999, // Wrong seq
        content: 'Edited'
      };

      const response = await request(app)
        .put(`/v1/conversations/${conversationId}/messages/${userMsg.id}/edit`)
        .set('Authorization', authToken)
        .send({ intent })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'validation_error',
        error_code: 'seq_mismatch',
        client_operation: 'test-op-102',
        details: {
          field: 'expected_seq',
          expected: 1,
          actual: 999
        }
      });
    });

    test('rejects edit of non-user message', async () => {
      const conversationId = 'test-conv-' + uuidv4();
      createConversation({
        id: conversationId,
        userId: testUser.id,
        sessionId: 'test-session',
        title: 'Test'
      });

      insertUserMessage({
        conversationId,
        content: 'User message',
        seq: 1
      });

      const assistantMsg = insertAssistantFinal({
        conversationId,
        content: 'Assistant message',
        seq: 2,
        responseId: 'resp-001'
      });

      const intent = {
        type: 'edit_message',
        client_operation: 'test-op-103',
        message_id: assistantMsg.id,
        expected_seq: 2,
        content: 'Trying to edit assistant'
      };

      const response = await request(app)
        .put(`/v1/conversations/${conversationId}/messages/${assistantMsg.id}/edit`)
        .set('Authorization', authToken)
        .send({ intent })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'validation_error',
        error_code: 'edit_not_allowed',
        client_operation: 'test-op-103',
        details: {
          field: 'role',
          expected: 'user',
          actual: 'assistant'
        }
      });
    });

    test('maintains backward compatibility without intent envelope', async () => {
      const conversationId = 'test-conv-' + uuidv4();
      createConversation({
        id: conversationId,
        userId: testUser.id,
        sessionId: 'test-session',
        title: 'Test'
      });

      const userMsg = insertUserMessage({
        conversationId,
        content: 'Original',
        seq: 1
      });

      const response = await request(app)
        .put(`/v1/conversations/${conversationId}/messages/${userMsg.id}/edit`)
        .set('Authorization', authToken)
        .send({
          content: 'Edited without intent'
        })
        .expect(200);

      // Response should be in legacy format
      expect(response.body.success).toBeUndefined();
      expect(response.body.client_operation).toBeUndefined();
      expect(response.body.message).toBeDefined();
      expect(response.body.new_conversation_id).toBeDefined();
    });
  });

  describe('Intent validation edge cases', () => {
    test('rejects malformed intent envelope', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', authToken)
        .send({
          intent: {
            // Missing type field
            client_operation: 'test-op-200'
          }
        })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'validation_error',
        error_code: 'invalid_intent'
      });
    });

    test('rejects intent with missing client_operation', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', authToken)
        .send({
          intent: {
            type: 'append_message',
            messages: [{
              role: 'user',
              content: 'Hello'
            }],
            completion: {}
          }
        })
        .expect(400);

      expect(response.body.error_code).toBe('invalid_intent');
    });

    test('handles intent with metadata', async () => {
      const intent = {
        type: 'append_message',
        client_operation: 'test-op-201',
        metadata: {
          source: 'test-suite',
          version: '1.0.0'
        },
        messages: [{
          role: 'user',
          content: 'Hello'
        }],
        completion: {
          model: 'gpt-3.5-turbo'
        }
      };

      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', authToken)
        .send({ intent })
        .expect(200);

      expect(response.body.metadata).toEqual({
        source: 'test-suite',
        version: '1.0.0'
      });
    });
  });
});
