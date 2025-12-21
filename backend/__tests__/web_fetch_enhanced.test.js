import { webFetchTool } from '../src/lib/tools/webFetch.js';

describe('web_fetch enhanced features', () => {
  describe('heading parameter as array', () => {
    it('should validate heading as an array of strings', () => {
      expect(
        webFetchTool.validate({
          url: 'https://example.com',
          heading: ['Introduction', 'Usage']
        })
      ).toEqual({
        url: 'https://example.com',
        maxChars: 10000,
        targetHeadings: ['Introduction', 'Usage'],
        useBrowser: false
      });
    });

    it('should validate heading as an array of numbers', () => {
      expect(
        webFetchTool.validate({
          url: 'https://example.com',
          heading: [1, 3]
        })
      ).toEqual({
        url: 'https://example.com',
        maxChars: 10000,
        targetHeadings: [1, 3],
        useBrowser: false
      });
    });

    it('should validate heading as a single string (backward compatibility)', () => {
      expect(
        webFetchTool.validate({
          url: 'https://example.com',
          heading: 'Introduction'
        })
      ).toEqual({
        url: 'https://example.com',
        maxChars: 10000,
        targetHeadings: ['Introduction'],
        useBrowser: false
      });
    });

    it('should reject invalid heading types', () => {
      expect(() =>
        webFetchTool.validate({
          url: 'https://example.com',
          heading: { name: 'Intro' }
        })
      ).toThrow('heading must be a string, number, or an array of strings/numbers');
    });
  });

  describe('continuation_token parameter', () => {
    it('should validate continuation_token', () => {
      const token = 'test-token-123';
      expect(
        webFetchTool.validate({
          continuation_token: token,
          max_chars: 5000
        })
      ).toEqual({
        continuation_token: token,
        maxChars: 5000
      });
    });

    it('should reject invalid continuation_token type', () => {
      expect(() =>
        webFetchTool.validate({
          continuation_token: 12345
        })
      ).toThrow('continuation_token must be a string');
    });

    it('should allow continuation_token without url', () => {
      expect(
        webFetchTool.validate({
          continuation_token: 'valid-token'
        })
      ).toEqual({
        continuation_token: 'valid-token',
        maxChars: 10000
      });
    });
  });

  describe('increased default max_chars', () => {
    it('should use 10000 as default max_chars', () => {
      const result = webFetchTool.validate({
        url: 'https://example.com'
      });
      expect(result.maxChars).toBe(10000);
    });
  });
});
