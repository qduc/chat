/**
 * Tests for message intent envelope implementation (Phase 2)
 */

import { 
  generateClientOperation,
  createAppendMessageIntent,
  createEditMessageIntent,
  isIntentSuccessResponse,
  isIntentErrorResponse,
} from '../lib/chat/intent';

describe('Message Intent Schema - Phase 2', () => {
  describe('generateClientOperation', () => {
    it('generates unique UUIDs', () => {
      const op1 = generateClientOperation();
      const op2 = generateClientOperation();
      
      expect(op1).toBeTruthy();
      expect(op2).toBeTruthy();
      expect(op1).not.toBe(op2);
      
      // Should be valid UUIDs
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(op1).toMatch(uuidRegex);
      expect(op2).toMatch(uuidRegex);
    });
  });

  describe('createAppendMessageIntent', () => {
    it('creates basic append intent for new conversation', () => {
      const envelope = createAppendMessageIntent({
        messages: [{ role: 'user', content: 'Hello' }],
        completion: { model: 'gpt-4', stream: true }
      });

      expect(envelope.intent.type).toBe('append_message');
      expect(envelope.intent.client_operation).toBeTruthy();
      expect(envelope.intent.messages).toHaveLength(1);
      expect(envelope.intent.messages[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(envelope.intent.completion).toEqual({ model: 'gpt-4', stream: true });
      expect(envelope.intent.conversation_id).toBeUndefined();
      expect(envelope.intent.after_message_id).toBeUndefined();
      expect(envelope.intent.after_seq).toBeUndefined();
    });

    it('creates append intent for existing conversation', () => {
      const envelope = createAppendMessageIntent({
        conversationId: 'conv-123',
        afterMessageId: 'msg-456',
        afterSeq: 5,
        messages: [{ role: 'user', content: 'Follow-up question' }],
        completion: { model: 'gpt-4', stream: true }
      });

      expect(envelope.intent.conversation_id).toBe('conv-123');
      expect(envelope.intent.after_message_id).toBe('msg-456');
      expect(envelope.intent.after_seq).toBe(5);
      expect(envelope.intent.truncate_after).toBeUndefined();
    });

    it('supports truncate_after for regeneration', () => {
      const envelope = createAppendMessageIntent({
        conversationId: 'conv-123',
        afterMessageId: 'msg-456',
        afterSeq: 5,
        truncateAfter: true,
        messages: [{ role: 'user', content: 'Regenerate' }],
        completion: { model: 'gpt-4', stream: true }
      });

      expect(envelope.intent.truncate_after).toBe(true);
    });

    it('includes metadata when provided', () => {
      const metadata = { test: true, env: 'dev' };
      const envelope = createAppendMessageIntent({
        messages: [{ role: 'user', content: 'Hello' }],
        completion: { model: 'gpt-4' },
        metadata
      });

      expect(envelope.intent.metadata).toEqual(metadata);
    });

    it('supports mixed content messages', () => {
      const mixedContent = [
        { type: 'text' as const, text: 'What is this?' },
        { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,...' } }
      ];
      
      const envelope = createAppendMessageIntent({
        messages: [{ role: 'user', content: mixedContent }],
        completion: { model: 'gpt-4-vision' }
      });

      expect(envelope.intent.messages[0].content).toEqual(mixedContent);
    });
  });

  describe('createEditMessageIntent', () => {
    it('creates edit intent with required fields', () => {
      const envelope = createEditMessageIntent({
        messageId: 'msg-789',
        expectedSeq: 3,
        content: 'Updated message content'
      });

      expect(envelope.intent.type).toBe('edit_message');
      expect(envelope.intent.client_operation).toBeTruthy();
      expect(envelope.intent.message_id).toBe('msg-789');
      expect(envelope.intent.expected_seq).toBe(3);
      expect(envelope.intent.content).toBe('Updated message content');
    });

    it('includes conversation_id when provided', () => {
      const envelope = createEditMessageIntent({
        conversationId: 'conv-123',
        messageId: 'msg-789',
        expectedSeq: 3,
        content: 'Updated content'
      });

      expect(envelope.intent.conversation_id).toBe('conv-123');
    });

    it('supports mixed content', () => {
      const mixedContent = [
        { type: 'text' as const, text: 'Updated with image' },
        { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,...' } }
      ];

      const envelope = createEditMessageIntent({
        messageId: 'msg-789',
        expectedSeq: 3,
        content: mixedContent
      });

      expect(envelope.intent.content).toEqual(mixedContent);
    });

    it('includes metadata when provided', () => {
      const metadata = { source: 'edit-ui' };
      const envelope = createEditMessageIntent({
        messageId: 'msg-789',
        expectedSeq: 3,
        content: 'Updated',
        metadata
      });

      expect(envelope.intent.metadata).toEqual(metadata);
    });
  });

  describe('Response type guards', () => {
    it('identifies intent success response', () => {
      const successResponse = {
        success: true,
        conversation_id: 'conv-123',
        client_operation: 'op-456',
        operations: {
          inserted: [{ id: 'msg-1', seq: 1, role: 'user' }],
          updated: [],
          deleted: []
        }
      };

      expect(isIntentSuccessResponse(successResponse)).toBe(true);
      expect(isIntentErrorResponse(successResponse)).toBe(false);
    });

    it('identifies intent error response', () => {
      const errorResponse = {
        success: false,
        error: 'validation_error' as const,
        error_code: 'seq_mismatch',
        message: 'Sequence number does not match',
        client_operation: 'op-456'
      };

      expect(isIntentErrorResponse(errorResponse)).toBe(true);
      expect(isIntentSuccessResponse(errorResponse)).toBe(false);
    });

    it('rejects invalid responses', () => {
      expect(isIntentSuccessResponse(null)).toBe(false);
      expect(isIntentSuccessResponse({})).toBe(false);
      expect(isIntentSuccessResponse({ success: true })).toBe(false);
      
      expect(isIntentErrorResponse(null)).toBe(false);
      expect(isIntentErrorResponse({})).toBe(false);
      expect(isIntentErrorResponse({ success: false })).toBe(false);
    });
  });

  describe('Intent envelope validation', () => {
    it('ensures all append intents have required fields', () => {
      const envelope = createAppendMessageIntent({
        messages: [{ role: 'user', content: 'test' }],
        completion: { model: 'gpt-4' }
      });

      expect(envelope.intent).toHaveProperty('type');
      expect(envelope.intent).toHaveProperty('client_operation');
      expect(envelope.intent).toHaveProperty('messages');
      expect(envelope.intent).toHaveProperty('completion');
    });

    it('ensures all edit intents have required fields', () => {
      const envelope = createEditMessageIntent({
        messageId: 'msg-1',
        expectedSeq: 1,
        content: 'test'
      });

      expect(envelope.intent).toHaveProperty('type');
      expect(envelope.intent).toHaveProperty('client_operation');
      expect(envelope.intent).toHaveProperty('message_id');
      expect(envelope.intent).toHaveProperty('expected_seq');
      expect(envelope.intent).toHaveProperty('content');
    });
  });
});
