// Tests for mixed content (text + images) support in messages
import assert from 'node:assert/strict';
import { getDb, resetDbCache, createConversation, insertUserMessage, getMessagesPage, getLastMessage, updateMessageContent, upsertSession } from '../src/db/index.js';
import { createUser } from '../src/db/users.js';
import { config } from '../src/env.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';

const sessionId = 'session-mixed-content-test';
let testUser;

beforeAll(() => {
  safeTestSetup();
});

beforeEach(() => {
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  const db = getDb();
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM conversations');
  db.exec('DELETE FROM sessions');
  db.exec('DELETE FROM users');

  // Create test user
  testUser = createUser({
    email: 'mixedcontent@example.com',
    passwordHash: 'test-hash',
    displayName: 'Mixed Content Test User'
  });

  upsertSession(sessionId, { userId: testUser.id });
});

afterAll(() => {
  resetDbCache();
});

describe('Mixed Content (Images) Support', () => {
  test('insertUserMessage stores and retrieves mixed content with images', () => {
    const conversationId = 'conv-mixed-1';
    createConversation({ id: conversationId, sessionId, userId: testUser.id });

    // Create mixed content with text and image
    const mixedContent = [
      { type: 'text', text: 'Check out this image:' },
      {
        type: 'image_url',
        image_url: {
          url: 'http://localhost:3001/v1/images/test-image-123',
          detail: 'auto'
        }
      },
      { type: 'text', text: 'What do you see?' }
    ];

    // Insert message with mixed content
    const result = insertUserMessage({
      conversationId,
      content: mixedContent,
      seq: 1
    });

    assert.ok(result.id);
    assert.equal(result.seq, 1);

    // Retrieve message and verify mixed content is preserved
    const messages = getMessagesPage({ conversationId });
    assert.equal(messages.messages.length, 1);

    const message = messages.messages[0];
    assert.ok(Array.isArray(message.content), 'Content should be an array');
    assert.equal(message.content.length, 3);

    // Verify text content
    assert.equal(message.content[0].type, 'text');
    assert.equal(message.content[0].text, 'Check out this image:');

    // Verify image content
    assert.equal(message.content[1].type, 'image_url');
    assert.equal(message.content[1].image_url.url, 'http://localhost:3001/v1/images/test-image-123');
    assert.equal(message.content[1].image_url.detail, 'auto');

    // Verify second text content
    assert.equal(message.content[2].type, 'text');
    assert.equal(message.content[2].text, 'What do you see?');
  });

    test('insertUserMessage stores plain text content (backward compatibility)', () => {
    const conversationId = 'conv-text-1';
    createConversation({ id: conversationId, sessionId, userId: testUser.id });

    // Insert message with plain text
    insertUserMessage({
      conversationId,
      content: 'Hello, world!',
      seq: 1
    });

    // Retrieve message and verify text is preserved
    const messages = getMessagesPage({ conversationId });
    assert.equal(messages.messages.length, 1);

    const message = messages.messages[0];
    assert.equal(typeof message.content, 'string');
    assert.equal(message.content, 'Hello, world!');
  });

    test('getLastMessage retrieves mixed content correctly', () => {
    const conversationId = 'conv-mixed-2';
    createConversation({ id: conversationId, sessionId, userId: testUser.id });

    const mixedContent = [
      { type: 'text', text: 'Image analysis:' },
      { type: 'image_url', image_url: { url: 'http://localhost:3001/v1/images/img-456' } }
    ];

    insertUserMessage({ conversationId, content: mixedContent, seq: 1 });

    const lastMessage = getLastMessage({ conversationId });
    assert.ok(lastMessage);
    assert.ok(Array.isArray(lastMessage.content));
    assert.equal(lastMessage.content.length, 2);
    assert.equal(lastMessage.content[0].type, 'text');
    assert.equal(lastMessage.content[1].type, 'image_url');
  });

    test('updateMessageContent updates mixed content', () => {
    const conversationId = 'conv-mixed-3';
    createConversation({ id: conversationId, sessionId, userId: testUser.id });

    // Insert initial message
    const result = insertUserMessage({
      conversationId,
      content: 'Original text',
      seq: 1
    });

    // Update to mixed content
    const updatedContent = [
      { type: 'text', text: 'Updated text with image:' },
      { type: 'image_url', image_url: { url: 'http://localhost:3001/v1/images/new-img' } }
    ];

    updateMessageContent({
      messageId: result.id,
      conversationId,
      userId: testUser.id,
      content: updatedContent
    });

    // Verify update
    const messages = getMessagesPage({ conversationId });
    const message = messages.messages[0];
    assert.ok(Array.isArray(message.content));
    assert.equal(message.content.length, 2);
    assert.equal(message.content[0].text, 'Updated text with image:');
    assert.equal(message.content[1].image_url.url, 'http://localhost:3001/v1/images/new-img');
  });

    test('multiple images in single message', () => {
    const conversationId = 'conv-multi-img';
    createConversation({ id: conversationId, sessionId, userId: testUser.id });

    const multiImageContent = [
      { type: 'text', text: 'Compare these images:' },
      { type: 'image_url', image_url: { url: 'http://localhost:3001/v1/images/img-1' } },
      { type: 'image_url', image_url: { url: 'http://localhost:3001/v1/images/img-2' } },
      { type: 'image_url', image_url: { url: 'http://localhost:3001/v1/images/img-3' } },
      { type: 'text', text: 'What are the differences?' }
    ];

    insertUserMessage({ conversationId, content: multiImageContent, seq: 1 });

    const messages = getMessagesPage({ conversationId });
    const message = messages.messages[0];

    assert.ok(Array.isArray(message.content));
    assert.equal(message.content.length, 5);

    // Count images
    const imageCount = message.content.filter(part => part.type === 'image_url').length;
    assert.equal(imageCount, 3);
  });

    test('content_json field is not exposed in API response', () => {
    const conversationId = 'conv-no-json';
    createConversation({ id: conversationId, sessionId, userId: testUser.id });

    const mixedContent = [
      { type: 'text', text: 'Test' },
      { type: 'image_url', image_url: { url: 'http://localhost:3001/v1/images/test' } }
    ];

    insertUserMessage({ conversationId, content: mixedContent, seq: 1 });

    const messages = getMessagesPage({ conversationId });
    const message = messages.messages[0];

    // Verify content_json is not in response
    assert.equal(message.content_json, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(message, 'content_json'), false);
  });
});
