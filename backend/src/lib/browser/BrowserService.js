class BrowserService {
  /**
   * Fetches content from a URL using a browser engine.
   * Logic splits based on environment:
   * - Electron: Uses native BrowserWindow
   * - Server/Docker: Uses Puppeteer/Chromium
   * @param {string} url
   * @param {Object} [options]
   * @returns {Promise<string>} HTML content
   */
  async fetchPageContent(url, options = {}) {
    if (process.env.IS_ELECTRON) {
      // Use Electron's native browser capabilities (singleton)
      const { electronProvider } = await import('./ElectronProvider.js');
      return electronProvider.fetchPageContent(url, options);
    } else {
      // Use Playwright (headless Chrome)
      const { playwrightProvider } = await import('./PlaywrightProvider.js');
      return playwrightProvider.fetchPageContent(url, options);
    }
  }
}

export const browserService = new BrowserService();
