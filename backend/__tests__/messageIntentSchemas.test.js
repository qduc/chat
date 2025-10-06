import { describe, test, expect } from '@jest/globals';
import {
  validateAppendMessageIntent,
  validateEditMessageIntent,
  validateIntent,
  validateIntentEnvelope,
  createIntentError,
  createIntentSuccess
} from '../src/lib/validation/messageIntentSchemas.js';

describe('Message Intent Schemas', () => {
  describe('AppendMessageIntent', () => {
    test('validates new conversation append (no conversation_id)', () => {
      const intent = {
        type: 'append_message',
        client_operation: 'test-op-123',
        messages: [{
          role: 'user',
          content: 'Hello world'
        }],
        completion: {
          model: 'gpt-4',
          max_tokens: 100
        }
      };
      
      expect(() => validateAppendMessageIntent(intent)).not.toThrow();
    });

    test('validates append to existing conversation', () => {
      const intent = {
        type: 'append_message',
        client_operation: 'test-op-123',
        conversation_id: '123e4567-e89b-12d3-a456-426614174000',
        after_message_id: '123e4567-e89b-12d3-a456-426614174001',
        after_seq: 5,
        messages: [{
          role: 'user',
          content: 'Hello world'
        }],
        completion: {
          model: 'gpt-4'
        }
      };
      
      expect(() => validateAppendMessageIntent(intent)).not.toThrow();
    });

    test('validates append with truncate_after', () => {
      const intent = {
        type: 'append_message',
        client_operation: 'test-op-123',
        conversation_id: '123e4567-e89b-12d3-a456-426614174000',
        after_message_id: '123e4567-e89b-12d3-a456-426614174001',
        after_seq: 3,
        truncate_after: true,
        messages: [{
          role: 'user',
          content: 'Hello world'
        }],
        completion: {}
      };
      
      expect(() => validateAppendMessageIntent(intent)).not.toThrow();
    });

    test('validates append with mixed content (images)', () => {
      const intent = {
        type: 'append_message',
        client_operation: 'test-op-123',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            { type: 'image_url', image_url: 'https://example.com/image.jpg' }
          ]
        }],
        completion: {}
      };
      
      expect(() => validateAppendMessageIntent(intent)).not.toThrow();
    });

    test('validates append with metadata', () => {
      const intent = {
        type: 'append_message',
        client_operation: 'test-op-123',
        metadata: { source: 'mobile-app', version: '1.0.0' },
        messages: [{
          role: 'user',
          content: 'Hello'
        }],
        completion: {}
      };
      
      expect(() => validateAppendMessageIntent(intent)).not.toThrow();
    });

    test('rejects append without client_operation', () => {
      const intent = {
        type: 'append_message',
        messages: [{
          role: 'user',
          content: 'Hello'
        }],
        completion: {}
      };
      
      expect(() => validateAppendMessageIntent(intent)).toThrow('client_operation');
    });

    test('rejects append with conversation_id but missing after_message_id', () => {
      const intent = {
        type: 'append_message',
        client_operation: 'test-op-123',
        conversation_id: '123e4567-e89b-12d3-a456-426614174000',
        messages: [{
          role: 'user',
          content: 'Hello'
        }],
        completion: {}
      };
      
      expect(() => validateAppendMessageIntent(intent)).toThrow();
    });

    test('rejects append with after_message_id but missing after_seq', () => {
      const intent = {
        type: 'append_message',
        client_operation: 'test-op-123',
        conversation_id: '123e4567-e89b-12d3-a456-426614174000',
        after_message_id: '123e4567-e89b-12d3-a456-426614174001',
        messages: [{
          role: 'user',
          content: 'Hello'
        }],
        completion: {}
      };
      
      expect(() => validateAppendMessageIntent(intent)).toThrow();
    });

    test('rejects append with empty messages array', () => {
      const intent = {
        type: 'append_message',
        client_operation: 'test-op-123',
        messages: [],
        completion: {}
      };
      
      expect(() => validateAppendMessageIntent(intent)).toThrow('At least one message');
    });

    test('rejects append with non-user role message', () => {
      const intent = {
        type: 'append_message',
        client_operation: 'test-op-123',
        messages: [{
          role: 'assistant',
          content: 'Hello'
        }],
        completion: {}
      };
      
      expect(() => validateAppendMessageIntent(intent)).toThrow();
    });

    test('rejects append with invalid conversation_id (not UUID)', () => {
      const intent = {
        type: 'append_message',
        client_operation: 'test-op-123',
        conversation_id: 'invalid-id',
        after_message_id: '123e4567-e89b-12d3-a456-426614174001',
        after_seq: 5,
        messages: [{
          role: 'user',
          content: 'Hello'
        }],
        completion: {}
      };
      
      expect(() => validateAppendMessageIntent(intent)).toThrow('UUID');
    });
  });

  describe('EditMessageIntent', () => {
    test('validates basic edit message intent', () => {
      const intent = {
        type: 'edit_message',
        client_operation: 'test-op-456',
        message_id: '123e4567-e89b-12d3-a456-426614174002',
        expected_seq: 3,
        content: 'Updated message content'
      };
      
      expect(() => validateEditMessageIntent(intent)).not.toThrow();
    });

    test('validates edit with mixed content', () => {
      const intent = {
        type: 'edit_message',
        client_operation: 'test-op-456',
        message_id: '123e4567-e89b-12d3-a456-426614174002',
        expected_seq: 3,
        content: [
          { type: 'text', text: 'Updated with image' },
          { type: 'image_url', image_url: 'https://example.com/new.jpg' }
        ]
      };
      
      expect(() => validateEditMessageIntent(intent)).not.toThrow();
    });

    test('validates edit with conversation_id', () => {
      const intent = {
        type: 'edit_message',
        client_operation: 'test-op-456',
        conversation_id: '123e4567-e89b-12d3-a456-426614174000',
        message_id: '123e4567-e89b-12d3-a456-426614174002',
        expected_seq: 3,
        content: 'Updated'
      };
      
      expect(() => validateEditMessageIntent(intent)).not.toThrow();
    });

    test('validates edit with metadata', () => {
      const intent = {
        type: 'edit_message',
        client_operation: 'test-op-456',
        message_id: '123e4567-e89b-12d3-a456-426614174002',
        expected_seq: 3,
        content: 'Updated',
        metadata: { edited_by: 'user', reason: 'typo' }
      };
      
      expect(() => validateEditMessageIntent(intent)).not.toThrow();
    });

    test('rejects edit without client_operation', () => {
      const intent = {
        type: 'edit_message',
        message_id: '123e4567-e89b-12d3-a456-426614174002',
        expected_seq: 3,
        content: 'Updated'
      };
      
      expect(() => validateEditMessageIntent(intent)).toThrow('client_operation');
    });

    test('rejects edit without message_id', () => {
      const intent = {
        type: 'edit_message',
        client_operation: 'test-op-456',
        expected_seq: 3,
        content: 'Updated'
      };
      
      expect(() => validateEditMessageIntent(intent)).toThrow();
    });

    test('rejects edit without expected_seq', () => {
      const intent = {
        type: 'edit_message',
        client_operation: 'test-op-456',
        message_id: '123e4567-e89b-12d3-a456-426614174002',
        content: 'Updated'
      };
      
      expect(() => validateEditMessageIntent(intent)).toThrow();
    });

    test('rejects edit with invalid message_id (not UUID)', () => {
      const intent = {
        type: 'edit_message',
        client_operation: 'test-op-456',
        message_id: 'not-a-uuid',
        expected_seq: 3,
        content: 'Updated'
      };
      
      expect(() => validateEditMessageIntent(intent)).toThrow('UUID');
    });

    test('rejects edit with zero expected_seq', () => {
      const intent = {
        type: 'edit_message',
        client_operation: 'test-op-456',
        message_id: '123e4567-e89b-12d3-a456-426614174002',
        expected_seq: 0,
        content: 'Updated'
      };
      
      expect(() => validateEditMessageIntent(intent)).toThrow('positive');
    });

    test('rejects edit with negative expected_seq', () => {
      const intent = {
        type: 'edit_message',
        client_operation: 'test-op-456',
        message_id: '123e4567-e89b-12d3-a456-426614174002',
        expected_seq: -1,
        content: 'Updated'
      };
      
      expect(() => validateEditMessageIntent(intent)).toThrow('positive');
    });
  });

  describe('Intent discriminated union', () => {
    test('validates append_message via generic intent validator', () => {
      const intent = {
        type: 'append_message',
        client_operation: 'test-op-123',
        messages: [{ role: 'user', content: 'Hello' }],
        completion: {}
      };
      
      expect(() => validateIntent(intent)).not.toThrow();
    });

    test('validates edit_message via generic intent validator', () => {
      const intent = {
        type: 'edit_message',
        client_operation: 'test-op-456',
        message_id: '123e4567-e89b-12d3-a456-426614174002',
        expected_seq: 3,
        content: 'Updated'
      };
      
      expect(() => validateIntent(intent)).not.toThrow();
    });

    test('rejects unknown intent type', () => {
      const intent = {
        type: 'unknown_intent',
        client_operation: 'test-op-789'
      };
      
      expect(() => validateIntent(intent)).toThrow();
    });
  });

  describe('IntentEnvelope', () => {
    test('validates envelope with append_message intent', () => {
      const envelope = {
        intent: {
          type: 'append_message',
          client_operation: 'test-op-123',
          messages: [{ role: 'user', content: 'Hello' }],
          completion: {}
        }
      };
      
      expect(() => validateIntentEnvelope(envelope)).not.toThrow();
    });

    test('validates envelope with edit_message intent', () => {
      const envelope = {
        intent: {
          type: 'edit_message',
          client_operation: 'test-op-456',
          message_id: '123e4567-e89b-12d3-a456-426614174002',
          expected_seq: 3,
          content: 'Updated'
        }
      };
      
      expect(() => validateIntentEnvelope(envelope)).not.toThrow();
    });

    test('rejects envelope without intent field', () => {
      const envelope = {
        type: 'append_message',
        client_operation: 'test-op-123'
      };
      
      expect(() => validateIntentEnvelope(envelope)).toThrow();
    });
  });

  describe('Error factory', () => {
    test('creates basic intent error', () => {
      const error = createIntentError(
        'conversation_not_found',
        'The specified conversation does not exist',
        'test-op-123'
      );
      
      expect(error).toEqual({
        success: false,
        error: 'validation_error',
        error_code: 'conversation_not_found',
        message: 'The specified conversation does not exist',
        client_operation: 'test-op-123'
      });
    });

    test('creates intent error without client_operation', () => {
      const error = createIntentError(
        'missing_required_field',
        'Required field is missing'
      );
      
      expect(error).toEqual({
        success: false,
        error: 'validation_error',
        error_code: 'missing_required_field',
        message: 'Required field is missing'
      });
    });

    test('creates intent error with details', () => {
      const error = createIntentError(
        'seq_mismatch',
        'Sequence number does not match',
        'test-op-123',
        {
          field: 'after_seq',
          expected: 5,
          actual: 3
        }
      );
      
      expect(error).toEqual({
        success: false,
        error: 'validation_error',
        error_code: 'seq_mismatch',
        message: 'Sequence number does not match',
        client_operation: 'test-op-123',
        details: {
          field: 'after_seq',
          expected: 5,
          actual: 3
        }
      });
    });
  });

  describe('Success factory', () => {
    test('creates basic intent success response', () => {
      const response = createIntentSuccess(
        '123e4567-e89b-12d3-a456-426614174000',
        'test-op-123',
        {
          inserted: [
            { id: '123e4567-e89b-12d3-a456-426614174001', seq: 1, role: 'user' },
            { id: '123e4567-e89b-12d3-a456-426614174002', seq: 2, role: 'assistant' }
          ],
          updated: [],
          deleted: []
        }
      );
      
      expect(response).toEqual({
        success: true,
        conversation_id: '123e4567-e89b-12d3-a456-426614174000',
        client_operation: 'test-op-123',
        operations: {
          inserted: [
            { id: '123e4567-e89b-12d3-a456-426614174001', seq: 1, role: 'user' },
            { id: '123e4567-e89b-12d3-a456-426614174002', seq: 2, role: 'assistant' }
          ],
          updated: [],
          deleted: []
        }
      });
    });

    test('creates intent success response with fork', () => {
      const response = createIntentSuccess(
        '123e4567-e89b-12d3-a456-426614174000',
        'test-op-456',
        {
          inserted: [],
          updated: [
            { id: '123e4567-e89b-12d3-a456-426614174002', seq: 3, role: 'user' }
          ],
          deleted: [
            { id: '123e4567-e89b-12d3-a456-426614174003', seq: 4, role: 'assistant' }
          ]
        },
        null,
        '123e4567-e89b-12d3-a456-426614174999'
      );
      
      expect(response).toEqual({
        success: true,
        conversation_id: '123e4567-e89b-12d3-a456-426614174000',
        client_operation: 'test-op-456',
        operations: {
          inserted: [],
          updated: [
            { id: '123e4567-e89b-12d3-a456-426614174002', seq: 3, role: 'user' }
          ],
          deleted: [
            { id: '123e4567-e89b-12d3-a456-426614174003', seq: 4, role: 'assistant' }
          ]
        },
        fork_conversation_id: '123e4567-e89b-12d3-a456-426614174999'
      });
    });

    test('creates intent success response with metadata', () => {
      const response = createIntentSuccess(
        '123e4567-e89b-12d3-a456-426614174000',
        'test-op-123',
        {
          inserted: [],
          updated: [],
          deleted: []
        },
        { source: 'mobile-app' }
      );
      
      expect(response).toEqual({
        success: true,
        conversation_id: '123e4567-e89b-12d3-a456-426614174000',
        client_operation: 'test-op-123',
        operations: {
          inserted: [],
          updated: [],
          deleted: []
        },
        metadata: { source: 'mobile-app' }
      });
    });
  });
});
