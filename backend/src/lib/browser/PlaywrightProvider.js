import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import pLimit from 'p-limit';

chromium.use(StealthPlugin());

class PlaywrightProvider {
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
    // We'll rename this to BROWSER_EXECUTABLE_PATH or keep it for compatibility or use PLAYWRIGHT_EXECUTABLE_PATH
    let executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
    let isAlpine = false;

    try {
      const fs = await import('fs');
      if (fs.existsSync('/etc/alpine-release')) {
        isAlpine = true;
      }
    } catch (e) {
      // Ignore
    }

    if (!executablePath && isAlpine) {
      executablePath = '/usr/bin/chromium-browser';
    }

    let args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--hide-scrollbars',
      '--mute-audio',
      '--disable-notifications',
      '--disable-extensions',
    ];

    if (executablePath) {
      console.log(`[PlaywrightProvider] Launching system Chromium at ${executablePath}`);
    } else {
      console.log(`[PlaywrightProvider] Launching bundled Playwright Chromium`);
    }

    const browser = await chromium.launch({
      args: args,
      executablePath: executablePath || undefined,
      headless: true,
    });

    return browser;
  }

  rescheduleCleanup() {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.timeoutId = setTimeout(() => this.cleanup(), 5 * 60 * 1000); // 5 minutes
  }

  async cleanup() {
    if (this.browser) {
      console.log('[PlaywrightProvider] Closing idle browser');
      await this.browser.close();
      this.browser = null;
    }
  }

  async fetchPageContent(url) {
    return this.limit(async () => {
      const browser = await this.getBrowser();
      // Use a fresh context for each request to avoid cookie/cache leaks
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: true,
      });

      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        const content = await page.content();
        return content;
      } catch (error) {
        console.error('[PlaywrightProvider] Error fetching page:', error);
        throw error;
      } finally {
        if (page) await page.close();
        if (context) await context.close();
        this.rescheduleCleanup();
      }
    });
  }
}

export const playwrightProvider = new PlaywrightProvider();
