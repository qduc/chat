import { filterModels, validateFilterString } from '../src/lib/modelFilter.js';

describe('modelFilter', () => {
  describe('filterModels', () => {
    const sampleModels = [
      { id: 'gpt-4' },
      { id: 'gpt-4-turbo' },
      { id: 'gpt-4o' },
      { id: 'gpt-3.5-turbo' },
      { id: 'claude-3-opus' },
      { id: 'claude-3-5-sonnet-20241022' },
      { id: 'claude-3-haiku' },
      { id: 'gemini/gemini-1.5-pro' },
      { id: 'gemini/gemini-1.5-flash' },
      { id: 'text-embedding-ada-002' },
    ];

    it('should return all models when no filter is provided', () => {
      const result = filterModels(sampleModels, '');
      expect(result.length).toBe(sampleModels.length);
    });

    it('should return all models when filter is null', () => {
      const result = filterModels(sampleModels, null);
      expect(result.length).toBe(sampleModels.length);
    });

    it('should return all models when filter is undefined', () => {
      const result = filterModels(sampleModels, undefined);
      expect(result.length).toBe(sampleModels.length);
    });

    it('should filter models with prefix wildcard: gpt-4*', () => {
      const result = filterModels(sampleModels, 'gpt-4*');
      expect(result.length).toBe(3);
      expect(result.every(m => m.id.startsWith('gpt-4'))).toBe(true);
    });

    it('should filter models with suffix wildcard: *sonnet*', () => {
      const result = filterModels(sampleModels, '*sonnet*');
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('claude-3-5-sonnet-20241022');
    });

    it('should filter models with path pattern: gemini/*', () => {
      const result = filterModels(sampleModels, 'gemini/*');
      expect(result.length).toBe(2);
      expect(result.every(m => m.id.startsWith('gemini/'))).toBe(true);
    });

    it('should filter models with multiple patterns separated by semicolon', () => {
      const result = filterModels(sampleModels, 'gpt-4*; *sonnet*; gemini/*');
      expect(result.length).toBe(6);
      // Should include: gpt-4, gpt-4-turbo, gpt-4o, claude-3-5-sonnet-20241022, gemini/gemini-1.5-pro, gemini/gemini-1.5-flash
    });

    it('should handle patterns with extra whitespace', () => {
      const result = filterModels(sampleModels, '  gpt-4* ;  *sonnet*  ; gemini/*  ');
      expect(result.length).toBe(6);
    });

    it('should be case-insensitive', () => {
      const result = filterModels(sampleModels, 'GPT-4*');
      expect(result.length).toBe(3);
      expect(result.every(m => m.id.toLowerCase().startsWith('gpt-4'))).toBe(true);
    });

    it('should handle exact match (no wildcards)', () => {
      const result = filterModels(sampleModels, 'gpt-4o');
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('gpt-4o');
    });

    it('should return empty array when no models match', () => {
      const result = filterModels(sampleModels, 'nonexistent-model*');
      expect(result.length).toBe(0);
    });

    it('should handle wildcard-only pattern', () => {
      const result = filterModels(sampleModels, '*');
      expect(result.length).toBe(sampleModels.length);
    });

    it('should handle multiple wildcards in a single pattern', () => {
      const result = filterModels(sampleModels, '*claude*sonnet*');
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('claude-3-5-sonnet-20241022');
    });

    it('should return empty array for null models input', () => {
      const result = filterModels(null, 'gpt-4*');
      expect(result.length).toBe(0);
    });

    it('should return empty array for undefined models input', () => {
      const result = filterModels(undefined, 'gpt-4*');
      expect(result.length).toBe(0);
    });

    it('should skip models without id field', () => {
      const modelsWithMissing = [
        { id: 'gpt-4' },
        { name: 'no-id' },
        { id: 'gpt-4o' },
        null,
        { id: 'claude-3-opus' },
      ];
      const result = filterModels(modelsWithMissing, 'gpt-4*');
      expect(result.length).toBe(2);
    });

    it('should handle complex real-world filter', () => {
      const result = filterModels(sampleModels, 'gpt-4o*; claude-3-5*; gemini/gemini-1.5-pro');
      expect(result.length).toBe(3);
      expect(result.some(m => m.id === 'gpt-4o')).toBe(true);
      expect(result.some(m => m.id === 'claude-3-5-sonnet-20241022')).toBe(true);
      expect(result.some(m => m.id === 'gemini/gemini-1.5-pro')).toBe(true);
    });

    it('should handle patterns with special regex characters', () => {
      const specialModels = [
        { id: 'model-v1.0' },
        { id: 'model-v2.0' },
        { id: 'model+plus' },
      ];
      const result = filterModels(specialModels, 'model-v1.0');
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('model-v1.0');
    });

    it('should handle empty pattern after semicolon', () => {
      const result = filterModels(sampleModels, 'gpt-4*; ; *sonnet*');
      expect(result.length).toBe(4);
    });
  });

  describe('validateFilterString', () => {
    it('should validate empty string as valid', () => {
      const result = validateFilterString('');
      expect(result.valid).toBe(true);
    });

    it('should validate null as valid', () => {
      const result = validateFilterString(null);
      expect(result.valid).toBe(true);
    });

    it('should validate undefined as valid', () => {
      const result = validateFilterString(undefined);
      expect(result.valid).toBe(true);
    });

    it('should validate simple pattern as valid', () => {
      const result = validateFilterString('gpt-4*');
      expect(result.valid).toBe(true);
    });

    it('should validate multiple patterns as valid', () => {
      const result = validateFilterString('gpt-4*; *sonnet*; gemini/*');
      expect(result.valid).toBe(true);
    });

    it('should reject extremely long patterns', () => {
      const longPattern = 'a'.repeat(201);
      const result = validateFilterString(longPattern);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too long');
    });

    it('should validate whitespace-only as valid (will be trimmed)', () => {
      const result = validateFilterString('   ');
      expect(result.valid).toBe(true);
    });

    it('should validate patterns with special characters as valid', () => {
      const result = validateFilterString('model-v1.0; model+plus; model(experimental)');
      expect(result.valid).toBe(true);
    });

    it('should reject filter with only semicolons', () => {
      const result = validateFilterString(';;;');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('No valid patterns');
    });
  });
});
