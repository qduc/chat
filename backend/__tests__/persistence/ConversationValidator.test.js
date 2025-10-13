import assert from 'node:assert/strict';
import { jest } from '@jest/globals';

const conversationsModule = new URL('../../src/db/conversations.js', import.meta.url).href;
const messagesModule = new URL('../../src/db/messages.js', import.meta.url).href;

// Mock the db functions
let mockCountConversationsBySession = () => 0;
let mockCountMessagesByConversation = () => 0;

// Mock the db module
jest.unstable_mockModule(conversationsModule, () => ({
  countConversationsBySession: (...args) => mockCountConversationsBySession(...args),
}));

jest.unstable_mockModule(messagesModule, () => ({
  countMessagesByConversation: (...args) => mockCountMessagesByConversation(...args),
}));

describe('ConversationValidator', () => {
  let validator;
  let ConversationValidator;
  let ValidationErrors;
  const mockConfig = {
    persistence: {
      maxConversationsPerSession: 5,
      maxMessagesPerConversation: 10,
    },
  };

  beforeAll(async () => {
    const module = await import('../../src/lib/persistence/ConversationValidator.js');
    ConversationValidator = module.ConversationValidator;
    ValidationErrors = module.ValidationErrors;
  });

  beforeEach(() => {
    validator = new ConversationValidator(mockConfig);
    // Reset mocks
    mockCountConversationsBySession = () => 0;
    mockCountMessagesByConversation = () => 0;
  });

  describe('validateConversationLimit', () => {
    test('should return null when under limit', () => {
      mockCountConversationsBySession = () => 3;

      const result = validator.validateConversationLimit('session123');

      assert.equal(result, null);
    });

    test('should use default limit when config missing', () => {
      const validatorWithoutConfig = new ConversationValidator({});
      mockCountConversationsBySession = () => 100;

      const result = validatorWithoutConfig.validateConversationLimit('session123');

      assert.equal(result.type, ValidationErrors.CONVERSATION_LIMIT_EXCEEDED);
      assert.equal(result.details.max, 100);
    });
  });

  describe('validateMessageLimit', () => {
    test('should return null when under limit', () => {
      mockCountMessagesByConversation = () => 5;

      const result = validator.validateMessageLimit('conv123');

      assert.equal(result, null);
    });

    test('should use default limit when config missing', () => {
      const validatorWithoutConfig = new ConversationValidator({});
      mockCountMessagesByConversation = () => 1000;

      const result = validatorWithoutConfig.validateMessageLimit('conv123');

      assert.equal(result.type, ValidationErrors.MESSAGE_LIMIT_EXCEEDED);
      assert.equal(result.details.max, 1000);
    });
  });

  describe('validateConversationAccess', () => {
    test('should return null when conversation exists', () => {
      const mockConversation = { id: 'conv123', sessionId: 'session123' };

      const result = validator.validateConversationAccess(mockConversation, 'conv123', 'session123');

      assert.equal(result, null);
    });

    test('should return error when conversation does not exist', () => {
      const result = validator.validateConversationAccess(null, 'conv123', 'session123');

      assert.equal(result.type, ValidationErrors.CONVERSATION_NOT_FOUND);
      assert.equal(result.statusCode, 404);
      assert.equal(result.details.conversationId, 'conv123');
      assert.equal(result.details.sessionId, 'session123');
    });
  });

  describe('validateRequest', () => {
    test('should validate new conversation successfully', () => {
      mockCountConversationsBySession = () => 3;

      const result = validator.validateRequest({
        sessionId: 'session123',
        isNewConversation: true,
      });

      assert.equal(result, null);
    });

    test('should validate existing conversation successfully', () => {
      const mockConversation = { id: 'conv123', sessionId: 'session123' };
      mockCountMessagesByConversation = () => 5;

      const result = validator.validateRequest({
        conversationId: 'conv123',
        sessionId: 'session123',
        existingConversation: mockConversation,
        isNewConversation: false,
      });

      assert.equal(result, null);
    });

    test('should return error for invalid conversation access', () => {
      const result = validator.validateRequest({
        conversationId: 'conv123',
        sessionId: 'session123',
        existingConversation: null,
        isNewConversation: false,
      });

      assert.equal(result.type, ValidationErrors.CONVERSATION_NOT_FOUND);
    });
  });
});
