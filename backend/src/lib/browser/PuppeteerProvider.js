import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import pLimit from 'p-limit';

class PuppeteerProvider {
  constructor() {
    this.browser = null;
    this.browserPromise = null; // Promise-based lock for concurrent initialization
    this.timeoutId = null;
    this.limit = pLimit(5); // Max 5 concurrent pages
  }

  async getBrowser() {
    if (this.browser) {
      this.rescheduleCleanup();
      return this.browser;
    }

    // Return existing initialization if in progress (prevents race condition)
    if (this.browserPromise) {
      return this.browserPromise;
    }

    this.browserPromise = this._initBrowser();
    try {
      this.browser = await this.browserPromise;
      this.rescheduleCleanup();
      return this.browser;
    } finally {
      this.browserPromise = null;
    }
  }

  /**
   * Initialize browser instance (separated for race condition handling)
   * @returns {Promise<Browser>}
   */
  async _initBrowser() {
    // Determine executable path
    // In Docker (Alpine), we set PUPPETEER_EXECUTABLE_PATH.
    // Use it if available, otherwise try @sparticuz/chromium or default.
    let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

    if (!executablePath) {
      try {
        executablePath = await chromium.executablePath();
      } catch (error) {
        // Fallback or ignore if running locally without the lambda layer
        console.debug('Could not get chromium executable path from @sparticuz/chromium', error);
      }
    }

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath || '/usr/bin/chromium-browser',
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    return browser;
  }

  rescheduleCleanup() {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.timeoutId = setTimeout(() => this.cleanup(), 5 * 60 * 1000); // 5 minutes
  }

  async cleanup() {
    if (this.browser) {
      console.log('[PuppeteerProvider] Closing idle browser');
      await this.browser.close();
      this.browser = null;
    }
  }

  async fetchPageContent(url) {
    return this.limit(async () => {
      const browser = await this.getBrowser();
      const page = await browser.newPage();
      try {
        // Basic bot evasion / settings
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        const content = await page.content();
        return content;
      } catch (error) {
        console.error('[PuppeteerProvider] Error fetching page:', error);
        throw error;
      } finally {
        if (page) await page.close();
        this.rescheduleCleanup();
      }
    });
  }
}

export const puppeteerProvider = new PuppeteerProvider();
