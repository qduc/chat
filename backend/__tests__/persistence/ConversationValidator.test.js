import assert from 'node:assert/strict';
import { ConversationValidator, ValidationErrors } from '../../src/lib/persistence/ConversationValidator.js';

// Mock the db functions
let mockCountConversationsBySession = () => 0;
let mockCountMessagesByConversation = () => 0;

// Mock the db module
jest.unstable_mockModule('../../src/db/index.js', () => ({
  countConversationsBySession: (...args) => mockCountConversationsBySession(...args),
  countMessagesByConversation: (...args) => mockCountMessagesByConversation(...args),
}));

describe('ConversationValidator', () => {
  let validator;
  const mockConfig = {
    persistence: {
      maxConversationsPerSession: 5,
      maxMessagesPerConversation: 10,
    },
  };

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

    test('should return error when limit exceeded', () => {
      mockCountConversationsBySession = () => 5;

      const result = validator.validateConversationLimit('session123');

      assert.equal(result.type, ValidationErrors.CONVERSATION_LIMIT_EXCEEDED);
      assert.equal(result.statusCode, 429);
      assert.equal(result.details.current, 5);
      assert.equal(result.details.max, 5);
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

    test('should return error when limit exceeded', () => {
      mockCountMessagesByConversation = () => 10;

      const result = validator.validateMessageLimit('conv123');

      assert.equal(result.type, ValidationErrors.MESSAGE_LIMIT_EXCEEDED);
      assert.equal(result.statusCode, 429);
      assert.equal(result.details.current, 10);
      assert.equal(result.details.max, 10);
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

    test('should return error for conversation limit exceeded on new conversation', () => {
      mockCountConversationsBySession = () => 5;

      const result = validator.validateRequest({
        sessionId: 'session123',
        isNewConversation: true,
      });

      assert.equal(result.type, ValidationErrors.CONVERSATION_LIMIT_EXCEEDED);
    });

    test('should return error for message limit exceeded on existing conversation', () => {
      const mockConversation = { id: 'conv123', sessionId: 'session123' };
      mockCountMessagesByConversation = () => 10;

      const result = validator.validateRequest({
        conversationId: 'conv123',
        sessionId: 'session123',
        existingConversation: mockConversation,
        isNewConversation: false,
      });

      assert.equal(result.type, ValidationErrors.MESSAGE_LIMIT_EXCEEDED);
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