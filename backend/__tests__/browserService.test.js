/**
 * Tests for BrowserService
 * Covers browser selection logic (Electron vs Playwright)
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';

describe('BrowserService', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear module cache to allow fresh imports with different env
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  describe('fetchPageContent', () => {
    test('uses Playwright provider in server environment', async () => {
      // Ensure IS_ELECTRON is not set
      delete process.env.IS_ELECTRON;

      // Mock the PlaywrightProvider
      const mockFetchPageContent = jest.fn().mockResolvedValue('<html>mocked content</html>');
      jest.unstable_mockModule('../src/lib/browser/PlaywrightProvider.js', () => ({
        playwrightProvider: {
          fetchPageContent: mockFetchPageContent
        }
      }));

      const { browserService } = await import('../src/lib/browser/BrowserService.js');

      const result = await browserService.fetchPageContent('https://example.com', { timeout: 5000 });

      expect(mockFetchPageContent).toHaveBeenCalledWith('https://example.com', { timeout: 5000 });
      expect(result).toBe('<html>mocked content</html>');
    });

    test('uses Electron provider when IS_ELECTRON is set', async () => {
      process.env.IS_ELECTRON = 'true';

      const mockFetchPageContent = jest.fn().mockResolvedValue('<html>electron content</html>');
      jest.unstable_mockModule('../src/lib/browser/ElectronProvider.js', () => ({
        electronProvider: {
          fetchPageContent: mockFetchPageContent
        }
      }));

      // Re-import to pick up new env
      const { browserService } = await import('../src/lib/browser/BrowserService.js');

      const result = await browserService.fetchPageContent('https://example.com');

      expect(mockFetchPageContent).toHaveBeenCalledWith('https://example.com', {});
      expect(result).toBe('<html>electron content</html>');
    });

    test('passes options to provider', async () => {
      delete process.env.IS_ELECTRON;

      const mockFetchPageContent = jest.fn().mockResolvedValue('<html></html>');
      jest.unstable_mockModule('../src/lib/browser/PlaywrightProvider.js', () => ({
        playwrightProvider: {
          fetchPageContent: mockFetchPageContent
        }
      }));

      const { browserService } = await import('../src/lib/browser/BrowserService.js');

      await browserService.fetchPageContent('https://stackoverflow.com/q/123', {
        waitSelector: '#question-header',
        timeout: 30000
      });

      expect(mockFetchPageContent).toHaveBeenCalledWith(
        'https://stackoverflow.com/q/123',
        { waitSelector: '#question-header', timeout: 30000 }
      );
    });

    test('propagates errors from provider', async () => {
      delete process.env.IS_ELECTRON;

      const mockFetchPageContent = jest.fn().mockRejectedValue(new Error('Navigation failed'));
      jest.unstable_mockModule('../src/lib/browser/PlaywrightProvider.js', () => ({
        playwrightProvider: {
          fetchPageContent: mockFetchPageContent
        }
      }));

      const { browserService } = await import('../src/lib/browser/BrowserService.js');

      await expect(browserService.fetchPageContent('https://example.com'))
        .rejects.toThrow('Navigation failed');
    });
  });

  describe('BrowserService class structure', () => {
    test('exports a singleton browserService instance', async () => {
      delete process.env.IS_ELECTRON;
      jest.unstable_mockModule('../src/lib/browser/PlaywrightProvider.js', () => ({
        playwrightProvider: { fetchPageContent: jest.fn() }
      }));

      const module = await import('../src/lib/browser/BrowserService.js');

      expect(module.browserService).toBeDefined();
      expect(typeof module.browserService.fetchPageContent).toBe('function');
    });
  });
});
