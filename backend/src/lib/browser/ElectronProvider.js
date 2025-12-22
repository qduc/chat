export class ElectronProvider {
  /**
   * Load URL with timeout to prevent hanging on slow/broken pages
   * @param {Electron.BrowserWindow} win
   * @param {string} url
   * @param {number} timeout - Timeout in milliseconds (default 30000)
   * @returns {Promise<void>}
   */
  _loadWithTimeout(win, url, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Page load timeout')), timeout);
      win.webContents.once('did-finish-load', () => {
        clearTimeout(timer);
        resolve();
      });
      win.webContents.once('did-fail-load', (_, code, desc) => {
        clearTimeout(timer);
        reject(new Error(`Load failed: ${desc}`));
      });
      win.loadURL(url);
    });
  }

  async fetchPageContent(url, options = {}) {
    const { waitSelector, timeout = 30000 } = options;
    let BrowserWindow;
    try {
      const electron = await import('electron');
      BrowserWindow = electron.BrowserWindow;
    } catch (error) {
      throw new Error(`Failed to import electron: ${error.message}`);
    }

    if (!BrowserWindow) {
      throw new Error('BrowserWindow is not defined in electron module');
    }

    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
        nodeIntegration: false,
        contextIsolation: true,
      }
    });

    try {
      await this._loadWithTimeout(win, url, timeout);

      if (waitSelector) {
        // Simple polling for selector in Electron
        await win.webContents.executeJavaScript(`
          new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
              if (document.querySelector('${waitSelector}')) {
                resolve(true);
              } else if (Date.now() - start > 10000) {
                resolve(false);
              } else {
                setTimeout(check, 100);
              }
            };
            check();
          })
        `);
      }

      const content = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
      return content;
    } catch (error) {
      // Add a comprehensive error message
      console.error('[ElectronProvider] Error fetching page:', error);
      throw error;
    } finally {
      // Ensure the window is destroyed to free memory
      if (!win.isDestroyed()) {
        win.destroy();
      }
    }
  }
}

// Export singleton instance for consistency with PuppeteerProvider
export const electronProvider = new ElectronProvider();
