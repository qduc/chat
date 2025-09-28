// Unit tests for system prompt validation schemas
import assert from 'node:assert/strict';
import {
  validateCreatePrompt,
  validateUpdatePrompt,
  validateSelectPrompt,
  validateClearSelection,
  validatePromptId,
  validateAnyPromptId,
  isBuiltInPromptId,
  isCustomPromptId,
} from '../src/lib/validation/systemPromptsSchemas.js';

describe('System prompt validation schemas', () => {
  describe('createPromptSchema', () => {
    test('rejects blank name', () => {
      assert.throws(
        () => validateCreatePrompt({ name: '   ', body: 'Keep it short.' }),
        /Name is required/
      );
    });

    test('rejects empty body', () => {
      assert.throws(
        () => validateCreatePrompt({ name: 'Valid', body: '   ' }),
        /Body is required/
      );
    });
  });

  describe('updatePromptSchema', () => {
    test('rejects empty payload', () => {
      assert.throws(
        () => validateUpdatePrompt({}),
        /At least one field must be provided/
      );
    });

    test('rejects blank update values', () => {
      assert.throws(
        () => validateUpdatePrompt({ name: ' ' }),
        /Name cannot be empty/
      );
      assert.throws(
        () => validateUpdatePrompt({ body: '' }),
        /Body cannot be empty/
      );
    });
  });

  describe('selectPromptSchema', () => {
    test('requires conversation_id', () => {
      assert.throws(
        () => validateSelectPrompt({}),
        /Required/
      );
    });

    test('allows null inline override but trims strings', () => {
      const parsed = validateSelectPrompt({ conversation_id: 'conv-1', inline_override: '  text  ' });
      assert.equal(parsed.inline_override, 'text');

      const parsedNull = validateSelectPrompt({ conversation_id: 'conv-1', inline_override: null });
      assert.equal(parsedNull.inline_override, null);
    });
  });

  describe('clearSelectionSchema', () => {
    test('requires conversation_id', () => {
      assert.throws(
        () => validateClearSelection({ conversation_id: '' }),
        /Conversation ID is required/
      );
    });
  });

  describe('prompt ID helpers', () => {
    test('validatePromptId rejects empty string', () => {
      assert.throws(() => validatePromptId(''), /Prompt ID is required/);
    });

    test('validateAnyPromptId accepts built-in and uuid formats', () => {
      assert.equal(validateAnyPromptId('built:classification'), 'built:classification');
      const uuid = '123e4567-e89b-12d3-a456-426614174000';
      assert.equal(validateAnyPromptId(uuid), uuid);
      assert.throws(() => validateAnyPromptId('not-valid'), /Invalid prompt ID format/);
    });

    test('type guards detect id shapes', () => {
      assert.equal(isBuiltInPromptId('built:test'), true);
      assert.equal(isBuiltInPromptId('123e4567-e89b-12d3-a456-426614174000'), false);
      assert.equal(isCustomPromptId('123e4567-e89b-12d3-a456-426614174000'), true);
      assert.equal(isCustomPromptId('built:test'), false);
    });
  });
});
