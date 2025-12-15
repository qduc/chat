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
    // However, if it's missing (e.g. env var lost), we manually check for Alpine to avoid
    // falling back to @sparticuz/chromium which provides a Glibc binary that crashes on Alpine (Musl).

    let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
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

    let args = chromium.args;
    if (executablePath) {
      // If we are using a system binary (Alpine), use standard args instead of Lambda-optimized ones
      // to avoid potential conflicts or missing libraries.
      args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--headless=new', // Modern headless mode
        '--hide-scrollbars',
        '--mute-audio',
        '--disable-notifications',
        '--disable-extensions',
      ];
      console.log(`[PuppeteerProvider] Launching system Chromium at ${executablePath}`);
    } else {
      // Fallback to sparticuz (Lambda or local without system chrome)
      try {
        executablePath = await chromium.executablePath();
        console.log(`[PuppeteerProvider] Launching bundled Chromium at ${executablePath}`);
      } catch (error) {
        console.debug('Could not get chromium executable path from @sparticuz/chromium', error);
      }
    }

    if (!executablePath) {
        throw new Error('Chromium executable path not found. Please set PUPPETEER_EXECUTABLE_PATH or ensure a supported environment.');
    }

    const browser = await puppeteer.launch({
      args: args,
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath,
      headless: executablePath ? 'new' : chromium.headless,
      ignoreHTTPSErrors: true,
      dumpio: true, // Log stdout/stderr from browser process to help debug launch issues
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
