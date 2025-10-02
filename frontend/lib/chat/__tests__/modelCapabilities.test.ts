import { supportsReasoningControls } from '../modelCapabilities';

describe('supportsReasoningControls', () => {
  describe('hardcoded model support', () => {
    it('returns true for gpt-5 models', () => {
      expect(supportsReasoningControls('gpt-5')).toBe(true);
      expect(supportsReasoningControls('gpt-5-mini')).toBe(true);
      expect(supportsReasoningControls('gpt-5.1')).toBe(true);
    });

    it('returns true for o3 models', () => {
      expect(supportsReasoningControls('o3')).toBe(true);
      expect(supportsReasoningControls('o3-mini')).toBe(true);
    });

    it('returns true for o4 models', () => {
      expect(supportsReasoningControls('o4')).toBe(true);
      expect(supportsReasoningControls('o4-mini')).toBe(true);
    });

    it('returns false for chat variants', () => {
      expect(supportsReasoningControls('gpt-5-chat')).toBe(false);
      expect(supportsReasoningControls('gpt-5.1-chat')).toBe(false);
      expect(supportsReasoningControls('o3-chat')).toBe(false);
    });

    it('returns false for other models', () => {
      expect(supportsReasoningControls('gpt-4o')).toBe(false);
      expect(supportsReasoningControls('gpt-4')).toBe(false);
      expect(supportsReasoningControls('claude-3-opus')).toBe(false);
    });

    it('returns false for undefined or empty model', () => {
      expect(supportsReasoningControls(undefined)).toBe(false);
      expect(supportsReasoningControls('')).toBe(false);
    });
  });

  describe('OpenRouter model capabilities', () => {
    it('returns true when supported_parameters includes reasoning', () => {
      const capabilities = {
        'openrouter/model-1': {
          supported_parameters: ['reasoning', 'temperature', 'max_tokens']
        }
      };
      expect(supportsReasoningControls('openrouter/model-1', capabilities)).toBe(true);
    });

    it('returns false when supported_parameters does not include reasoning', () => {
      const capabilities = {
        'openrouter/model-1': {
          supported_parameters: ['temperature', 'max_tokens']
        }
      };
      expect(supportsReasoningControls('openrouter/model-1', capabilities)).toBe(false);
    });

    it('falls back to hardcoded logic when model not in capabilities', () => {
      const capabilities = {
        'openrouter/model-1': {
          supported_parameters: ['reasoning']
        }
      };
      // gpt-5 should still return true even without capabilities entry
      expect(supportsReasoningControls('gpt-5', capabilities)).toBe(true);
      // Other models should return false
      expect(supportsReasoningControls('gpt-4o', capabilities)).toBe(false);
    });

    it('prefers capabilities over hardcoded logic', () => {
      const capabilities = {
        'gpt-4o': {
          supported_parameters: ['reasoning']
        }
      };
      // Even though gpt-4o is not in hardcoded list, capabilities say it supports reasoning
      expect(supportsReasoningControls('gpt-4o', capabilities)).toBe(true);
    });
  });

  describe('case insensitivity', () => {
    it('handles uppercase model names', () => {
      expect(supportsReasoningControls('GPT-5')).toBe(true);
      expect(supportsReasoningControls('O3-MINI')).toBe(true);
      expect(supportsReasoningControls('GPT-5-CHAT')).toBe(false);
    });

    it('handles mixed case model names', () => {
      expect(supportsReasoningControls('Gpt-5-Mini')).toBe(true);
      expect(supportsReasoningControls('O3-mini')).toBe(true);
    });
  });
});
