import { webFetchTool } from '../src/lib/tools/webFetch.js';

describe('web_fetch enhanced features', () => {
  describe('heading_range parameter', () => {
    it('should validate heading_range structure', () => {
      expect(
        webFetchTool.validate({
          url: 'https://example.com',
          heading_range: { start: 1, end: 3 }
        })
      ).toEqual({
        url: 'https://example.com',
        maxChars: 10000,
        targetHeading: null,
        headingRange: { start: 1, end: 3 }
      });
    });

    it('should reject invalid heading_range', () => {
      expect(() =>
        webFetchTool.validate({
          url: 'https://example.com',
          heading_range: { start: 0, end: 3 }
        })
      ).toThrow('heading_range must have start >= 1');
    });

    it('should reject heading_range with end < start', () => {
      expect(() =>
        webFetchTool.validate({
          url: 'https://example.com',
          heading_range: { start: 5, end: 3 }
        })
      ).toThrow('heading_range must have start >= 1 and end >= start');
    });

    it('should reject both heading and heading_range', () => {
      expect(() =>
        webFetchTool.validate({
          url: 'https://example.com',
          heading: 'Introduction',
          heading_range: { start: 1, end: 3 }
        })
      ).toThrow('Cannot use both "heading" and "heading_range" parameters');
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
