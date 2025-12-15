class BrowserService {
  /**
   * Fetches content from a URL using a browser engine.
   * Logic splits based on environment:
   * - Electron: Uses native BrowserWindow
   * - Server/Docker: Uses Puppeteer/Chromium
   * @param {string} url
   * @returns {Promise<string>} HTML content
   */
  async fetchPageContent(url) {
    if (process.env.IS_ELECTRON) {
      // Use Electron's native browser capabilities (singleton)
      const { electronProvider } = await import('./ElectronProvider.js');
      return electronProvider.fetchPageContent(url);
    } else {
      // Use Puppeteer (headless Chrome)
      const { puppeteerProvider } = await import('./PuppeteerProvider.js');
      return puppeteerProvider.fetchPageContent(url);
    }
  }
}

export const browserService = new BrowserService();
