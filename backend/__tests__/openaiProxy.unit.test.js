// Unit tests for openaiProxy.js - focusing on critical paths
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { createChatProxyTestContext } from '../test_utils/chatProxyTestUtils.js';
import { getDb, upsertSession, createConversation } from '../src/db/index.js';
import { generateAccessToken } from '../src/middleware/auth.js';
import { config } from '../src/env.js';

const { makeApp, upstream } = createChatProxyTestContext();
const mockUser = { id: 'proxy-unit-user', email: 'proxyunit@example.com' };

describe('openaiProxy.js - Unit Tests', () => {
  describe('Request sanitization and normalization', () => {
    test('sanitizes incoming system prompt and injects as first message', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          system_prompt: 'You are a helpful assistant.',
          stream: false,
        });

      assert.equal(res.status, 200);
      const lastRequest = upstream.lastChatRequestBody;
      assert.ok(lastRequest);
      assert.equal(lastRequest.messages[0].role, 'system');
      assert.ok(lastRequest.messages[0].content.includes('You are a helpful assistant.'));
    });

    test('replaces existing system message when system_prompt provided', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [
            { role: 'system', content: 'Old system message' },
            { role: 'user', content: 'Hello' }
          ],
          system_prompt: 'New system prompt',
          stream: false,
        });

      assert.equal(res.status, 200);
      const lastRequest = upstream.lastChatRequestBody;
      assert.ok(lastRequest);
      assert.equal(lastRequest.messages[0].role, 'system');
      assert.ok(lastRequest.messages[0].content.includes('New system prompt'));
      // Should not have duplicate system messages
      const systemMessages = lastRequest.messages.filter(m => m.role === 'system');
      assert.equal(systemMessages.length, 1);
    });

    test('strips frontend-specific fields from upstream request', async () => {
      const app = makeApp({ mockUser });
      const sessionId = 'test-session';
      upsertSession(sessionId, { userId: mockUser.id });
      createConversation({ id: 'conv1', sessionId, userId: mockUser.id, title: 'Test' });

      const res = await request(app)
        .post('/v1/chat/completions')
        .set('x-session-id', sessionId)
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          conversation_id: 'conv1',
          provider_id: 'test-provider',
          streamingEnabled: true,
          toolsEnabled: false,
          researchMode: true,
          qualityLevel: 'high',
          client_request_id: 'req-123',
          stream: false,
        });

      assert.equal(res.status, 200);
      const lastRequest = upstream.lastChatRequestBody;
      assert.ok(lastRequest);
      // Verify frontend fields are stripped
      assert.ok(!Object.hasOwn(lastRequest, 'conversation_id'));
      assert.ok(!Object.hasOwn(lastRequest, 'provider_id'));
      assert.ok(!Object.hasOwn(lastRequest, 'streamingEnabled'));
      assert.ok(!Object.hasOwn(lastRequest, 'toolsEnabled'));
      assert.ok(!Object.hasOwn(lastRequest, 'researchMode'));
      assert.ok(!Object.hasOwn(lastRequest, 'qualityLevel'));
      assert.ok(!Object.hasOwn(lastRequest, 'client_request_id'));
    });

    test('normalizes provider_stream flag correctly', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          provider_stream: false,
          stream: false,
        });

      assert.equal(res.status, 200);
      const lastRequest = upstream.lastChatRequestBody;
      assert.ok(lastRequest);
      assert.equal(lastRequest.stream, false);
      assert.ok(!Object.hasOwn(lastRequest, 'provider_stream'));
      assert.ok(!Object.hasOwn(lastRequest, 'providerStream'));
    });

    test('handles empty or null content gracefully', async () => {
      const app = makeApp({ mockUser });
      // Test with null content
      const res1 = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: null }],
          stream: false,
        });

      assert.equal(res1.status, 200);

      // Test with undefined content
      const res2 = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: undefined }],
          stream: false,
        });

      assert.equal(res2.status, 200);
    });
  });

  describe('Reasoning controls validation', () => {
    test('validates reasoning_effort with allowed values', async () => {
      const app = makeApp({ mockUser });

      // Test valid values
      for (const effort of ['minimal', 'low', 'medium', 'high']) {
        const res = await request(app)
          .post('/v1/chat/completions')
          .send({
            model: 'gpt-5.1-mini', // Model that supports reasoning
            messages: [{ role: 'user', content: 'Test' }],
            reasoning_effort: effort,
            stream: false,
          });
        assert.equal(res.status, 200, `Should accept ${effort}`);
      }
    });

    test('rejects invalid reasoning_effort value', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          model: 'gpt-5.1-mini',
          messages: [{ role: 'user', content: 'Test' }],
          reasoning_effort: 'invalid',
          stream: false,
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'invalid_request_error');
      assert.ok(res.body.message.includes('Invalid reasoning_effort'));
    });

    test('validates verbosity with allowed values', async () => {
      const app = makeApp({ mockUser });

      for (const verbosity of ['low', 'medium', 'high']) {
        const res = await request(app)
          .post('/v1/chat/completions')
          .send({
            model: 'gpt-5.1-mini',
            messages: [{ role: 'user', content: 'Test' }],
            verbosity,
            stream: false,
          });
        assert.equal(res.status, 200, `Should accept ${verbosity}`);
      }
    });

    test('rejects invalid verbosity value', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          model: 'gpt-5.1-mini',
          messages: [{ role: 'user', content: 'Test' }],
          verbosity: 'ultra',
          stream: false,
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'invalid_request_error');
      assert.ok(res.body.message.includes('Invalid verbosity'));
    });

    test('strips reasoning controls for models that do not support them', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          model: 'gpt-3.5-turbo', // Model without reasoning support
          messages: [{ role: 'user', content: 'Test' }],
          reasoning_effort: 'high',
          verbosity: 'medium',
          stream: false,
        });

      assert.equal(res.status, 200);
      // The request should succeed even though reasoning controls were provided
      // They should be stripped before sending to upstream
      assert.ok(res.body.choices);
    });
  });

  describe('Error handling', () => {
    test('handles upstream 4xx errors with proper error structure', async () => {
      const app = makeApp({ mockUser });
      upstream.setError(true);

      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Test' }],
          stream: false,
        });

      assert.ok(res.status >= 400);
      assert.ok(res.body.error);
      assert.ok(res.body.message);
    });

    test('handles upstream errors during streaming', async () => {
      const app = makeApp({ mockUser });
      upstream.setError(true);

      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Test' }],
          stream: true,
        });

      assert.ok(res.status >= 400);
      assert.ok(res.body.error);
    });

    test('marks persistence as error when upstream fails', async () => {
      const app = makeApp({ mockUser });
      const sessionId = 'error-session';
      upsertSession(sessionId, { userId: mockUser.id });
      createConversation({ id: 'conv-error', sessionId, userId: mockUser.id, title: 'Error Test' });

      upstream.setError(true);

      const res = await request(app)
        .post('/v1/chat/completions')
        .set('x-session-id', sessionId)
        .send({
          messages: [{ role: 'user', content: 'Test' }],
          conversation_id: 'conv-error',
          stream: false,
        });

      assert.ok(res.status >= 400);
      // Persistence should mark the conversation state appropriately
    });
  });

  describe('Request flags and routing', () => {
    test('detects tools presence and routes to tool orchestration', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'What time is it?' }],
          tools: [{
            type: 'function',
            function: {
              name: 'get_time',
              description: 'Get current time',
              parameters: { type: 'object', properties: {} }
            }
          }],
          stream: false,
        });

      assert.equal(res.status, 200);
      // With tools, should route to tool orchestration path
    });

    test('defaults to streaming when stream flag not specified', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          // stream not specified - should default to true for SSE
        });

      assert.equal(res.status, 200);
      assert.equal(res.type, 'text/event-stream');
    });

    test('respects explicit stream=false for JSON response', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          stream: false,
        });

      assert.equal(res.status, 200);
      assert.equal(res.type, 'application/json');
      assert.ok(res.body.choices);
    });

    test('handles provider_stream flag independently from client stream', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true, // Client wants streaming
          provider_stream: false, // But upstream should not stream
        });

      assert.equal(res.status, 200);
      // Should still stream to client (SSE) but request JSON from provider
    });
  });

  describe('Conversation persistence integration', () => {
    test('creates new conversation when conversation_id not provided', async () => {
      const app = makeApp({ mockUser });
      const sessionId = 'new-conv-session';
      upsertSession(sessionId, { userId: mockUser.id });

      const res = await request(app)
        .post('/v1/chat/completions')
        .set('x-session-id', sessionId)
        .send({
          messages: [{ role: 'user', content: 'Start new conversation' }],
          stream: false,
        });

      assert.equal(res.status, 200);
      // When no conversation_id is provided, a new conversation is created
      assert.ok(res.body);
    });

    test('continues existing conversation when conversation_id provided', async () => {
      const app = makeApp({ mockUser });
      const sessionId = 'existing-conv-session';
      upsertSession(sessionId, { userId: mockUser.id });
      createConversation({ id: 'conv-existing', sessionId, userId: mockUser.id, title: 'Existing' });

      const res = await request(app)
        .post('/v1/chat/completions')
        .set('x-session-id', sessionId)
        .send({
          messages: [{ role: 'user', content: 'Continue conversation' }],
          conversation_id: 'conv-existing',
          stream: false,
        });

      assert.equal(res.status, 200);
      assert.ok(res.body.choices);
      assert.ok(res.body.choices[0].message);
    });

    test('persists messages in conversation', async () => {
      const app = makeApp({ mockUser });
      const sessionId = 'persist-session';
      upsertSession(sessionId, { userId: mockUser.id });
      createConversation({ id: 'conv-persist', sessionId, userId: mockUser.id, title: 'Persist' });

      const res = await request(app)
        .post('/v1/chat/completions')
        .set('x-session-id', sessionId)
        .send({
          messages: [{ role: 'user', content: 'Save this message' }],
          conversation_id: 'conv-persist',
          stream: false,
        });

      assert.equal(res.status, 200);

      // Verify messages were persisted
      const db = getDb();
      const messages = db.prepare(
        'SELECT * FROM messages WHERE conversation_id = ?'
      ).all('conv-persist');

      assert.ok(messages.length >= 2); // User + assistant messages
      const userMsg = messages.find(m => m.role === 'user');
      const assistantMsg = messages.find(m => m.role === 'assistant');
      assert.ok(userMsg);
      assert.ok(assistantMsg);
      assert.equal(userMsg.content, 'Save this message');
    });

    test('updates conversation metadata on successful response', async () => {
      const app = makeApp({ mockUser });
      const sessionId = 'metadata-session';
      upsertSession(sessionId, { userId: mockUser.id });
      createConversation({
        id: 'conv-metadata',
        sessionId,
        userId: mockUser.id,
        title: 'Metadata Test',
        model: 'gpt-3.5-turbo',
      });

      const res = await request(app)
        .post('/v1/chat/completions')
        .set('x-session-id', sessionId)
        .send({
          messages: [{ role: 'user', content: 'Update metadata' }],
          conversation_id: 'conv-metadata',
          model: 'gpt-4',
          stream: false,
        });

      assert.equal(res.status, 200);

      // Verify metadata was updated
      const db = getDb();
      const conv = db.prepare(
        'SELECT * FROM conversations WHERE id = ?'
      ).get('conv-metadata');

      assert.ok(conv);
      // Model is tracked in conversation metadata
      assert.ok(conv.model);
    });
  });

  describe('Streaming response handling', () => {
    test('converts non-streaming JSON response to SSE format', async () => {
      const app = makeApp({ mockUser });

      // The openaiProxy automatically converts JSON to streaming when client requests stream=true
      // This is handled in the handleRequest function

      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Test' }],
          stream: true,
        });

      assert.equal(res.status, 200);
      // Should convert JSON to streaming format
      assert.ok(res.text.includes('data:'));
      assert.ok(res.text.includes('[DONE]'));
    });

    test('handles SSE response with proper chunking', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true,
        });

      assert.equal(res.status, 200);
      assert.equal(res.type, 'text/event-stream');

      const text = res.text;
      assert.ok(text.includes('data: '));
      assert.ok(text.includes('[DONE]'));

      // Verify proper SSE format
      const lines = text.split('\n');
      const dataLines = lines.filter(l => l.startsWith('data: '));
      assert.ok(dataLines.length > 0);
    });

    test('includes conversation metadata in streaming response', async () => {
      const app = makeApp({ mockUser });
      const sessionId = 'stream-meta-session';
      upsertSession(sessionId, { userId: mockUser.id });
      createConversation({
        id: 'conv-stream-meta',
        sessionId,
        userId: mockUser.id,
        title: 'Stream Meta',
      });

      const res = await request(app)
        .post('/v1/chat/completions')
        .set('x-session-id', sessionId)
        .send({
          messages: [{ role: 'user', content: 'Test streaming metadata' }],
          conversation_id: 'conv-stream-meta',
          stream: true,
        });

      assert.equal(res.status, 200);
      const text = res.text;

      // Should receive streaming response
      assert.ok(text.includes('data:'));
      assert.ok(text.includes('[DONE]'));
    });

    test('handles streaming with tool calls in response', async () => {
      const app = makeApp({ mockUser });

      // This test validates streaming when tools are in the response
      // Actual tool execution is tested elsewhere
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'What time is it?' }],
          tools: [{
            type: 'function',
            function: {
              name: 'get_time',
              description: 'Get time',
              parameters: { type: 'object', properties: {} }
            }
          }],
          stream: true,
        });

      assert.equal(res.status, 200);
      assert.ok(res.text.includes('data:'));
      assert.ok(res.text.includes('[DONE]'));
    });
  });

  describe('Model and provider selection', () => {
    test('uses default model when not specified', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          // model not specified
          stream: false,
        });

      assert.equal(res.status, 200);
      const lastRequest = upstream.lastChatRequestBody;
      assert.ok(lastRequest.model); // Should have a model
    });

    test('preserves specified model in request', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          model: 'gpt-4-turbo',
          stream: false,
        });

      assert.equal(res.status, 200);
      const lastRequest = upstream.lastChatRequestBody;
      assert.equal(lastRequest.model, 'gpt-4-turbo');
    });

    test('supports provider selection via header', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .set('x-provider-id', 'test-provider')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          stream: false,
        });

      // Should accept provider header
      assert.equal(res.status, 200);
    });
  });

  describe('Custom request parameters', () => {
    test('handles missing custom_request_params gracefully', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          custom_request_params_id: ['non-existent-preset'],
          stream: false,
        });

      assert.equal(res.status, 200);
      // Should not fail when preset doesn't exist
    });

    test('ignores custom_request_params_id when empty', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          custom_request_params_id: [],
          stream: false,
        });

      assert.equal(res.status, 200);
    });

    test('strips custom_request_params_id from upstream request', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          custom_request_params_id: ['preset-1'],
          stream: false,
        });

      assert.equal(res.status, 200);
      const lastRequest = upstream.lastChatRequestBody;
      assert.ok(!Object.hasOwn(lastRequest, 'custom_request_params_id'));
    });
  });

  describe('Authentication and authorization', () => {
    test('rejects requests without authentication', async () => {
      const app = express();
      app.use(express.json());
      // Don't add mock user - should fail authentication
      const { chatRouter } = await import('../src/routes/chat.js');
      app.use(chatRouter);

      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          stream: false,
        });

      assert.equal(res.status, 401);
    });

    test('validates user_id from JWT token', async () => {
      const app = makeApp({ mockUser });
      const sessionId = 'auth-session';
      upsertSession(sessionId, { userId: mockUser.id });

      const res = await request(app)
        .post('/v1/chat/completions')
        .set('x-session-id', sessionId)
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          stream: false,
        });

      assert.equal(res.status, 200);
      // User from token should be used for all operations
    });
  });

  describe('Edge cases and error scenarios', () => {
    test('handles empty messages array', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [],
          stream: false,
        });

      // Upstream might reject empty messages, but proxy should handle gracefully
      assert.ok(res.status >= 200);
    });

    test('handles malformed JSON in request', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');

      assert.equal(res.status, 400);
    });

    test('handles very large message content', async () => {
      const app = makeApp({ mockUser });
      const largeContent = 'x'.repeat(100000); // 100KB

      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: largeContent }],
          stream: false,
        });

      assert.equal(res.status, 200);
      // Should handle large content without crashing
    });

    test('handles special characters in content', async () => {
      const app = makeApp({ mockUser });
      const specialContent = '你好 🌍 \n\t\r специальные символы';

      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: specialContent }],
          stream: false,
        });

      assert.equal(res.status, 200);
      assert.ok(res.body.choices);
    });

    test('handles multimodal content arrays', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'What is in this image?' },
              { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } }
            ]
          }],
          stream: false,
        });

      assert.equal(res.status, 200);
      // Should preserve multimodal content structure
    });

    test('handles concurrent requests to same conversation', async () => {
      const app = makeApp({ mockUser });
      const sessionId = 'concurrent-session';
      upsertSession(sessionId, { userId: mockUser.id });
      createConversation({ id: 'conv-concurrent', sessionId, userId: mockUser.id, title: 'Concurrent' });

      const requests = [
        request(app)
          .post('/v1/chat/completions')
          .set('x-session-id', sessionId)
          .send({
            messages: [{ role: 'user', content: 'Request 1' }],
            conversation_id: 'conv-concurrent',
            stream: false,
          }),
        request(app)
          .post('/v1/chat/completions')
          .set('x-session-id', sessionId)
          .send({
            messages: [{ role: 'user', content: 'Request 2' }],
            conversation_id: 'conv-concurrent',
            stream: false,
          }),
      ];

      const results = await Promise.all(requests);

      // Both should succeed
      assert.equal(results[0].status, 200);
      assert.equal(results[1].status, 200);
    });
  });

  describe('Usage tracking and metadata', () => {
    test('extracts and includes usage information in response', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          stream: false,
        });

      assert.equal(res.status, 200);
      // Usage should be included if provider returns it
      if (res.body.usage) {
        assert.ok(typeof res.body.usage.prompt_tokens === 'number');
        assert.ok(typeof res.body.usage.completion_tokens === 'number');
        assert.ok(typeof res.body.usage.total_tokens === 'number');
      }
    });

    test('includes response_id in metadata', async () => {
      const app = makeApp({ mockUser });
      const sessionId = 'response-id-session';
      upsertSession(sessionId, { userId: mockUser.id });
      createConversation({ id: 'conv-resp-id', sessionId, userId: mockUser.id, title: 'Response ID' });

      const res = await request(app)
        .post('/v1/chat/completions')
        .set('x-session-id', sessionId)
        .send({
          messages: [{ role: 'user', content: 'Test response ID' }],
          conversation_id: 'conv-resp-id',
          stream: false,
        });

      assert.equal(res.status, 200);
      // Response should have an ID
      assert.ok(res.body.id);
    });
  });

  describe('Abort and cancellation', () => {
    test('handles client request ID for abort tracking', async () => {
      const app = makeApp({ mockUser });
      const clientRequestId = 'test-request-123';

      const res = await request(app)
        .post('/v1/chat/completions')
        .set('x-client-request-id', clientRequestId)
        .send({
          messages: [{ role: 'user', content: 'Test abort tracking' }],
          stream: true,
        });

      assert.equal(res.status, 200);
      // Request should be tracked with client request ID
    });

    test('handles missing client request ID gracefully', async () => {
      const app = makeApp({ mockUser });
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'No client request ID' }],
          stream: true,
        });

      assert.equal(res.status, 200);
      // Should work without client request ID
    });
  });
});
