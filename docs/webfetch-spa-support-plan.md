# WebFetch SPA Support Implementation Plan

## Overview

Upgrade the `webFetch` tool (`backend/src/lib/tools/webFetch.js`) with a browser engine to fetch content from Single Page Applications (SPAs) that require JavaScript execution.

**Current State**: The tool uses JSDOM which cannot execute JavaScript, limiting it to static HTML content.

**Goal**: Add browser fallback for SPAs while keeping JSDOM as the primary (lightweight) method.

## Approved Strategy

**Hybrid Engine Approach**:
1. **Server/Docker**: Use `@sparticuz/chromium` + `puppeteer-core`.
2. **Electron App**: Use native `BrowserWindow` (no extra dependencies).
3. **Trigger**: Try JSDOM first. Auto-fallback to browser if content is missing or requires JS.

## Research Decisions (Tasks Resolved)

- **Engine Selection**: `@sparticuz/chromium` chosen for server environments (Node 20+ compatible).
- **Docker Optimization**: Will use Alpine Linux packages (`apk add chromium`) instead of complex manual builds.
- **Pooling**: Will implement a simple LRU-style pool (max 2 instances) directly.
- **SPA Detection**: "Failure-driven" detection (fallback if JSDOM gets <300 chars or specific "enable JS" warnings) instead of complex heuristics.

## Implementation Steps

### Step 1: Install Server Dependencies
For `backend/` only:
```bash
npm install puppeteer-core @sparticuz/chromium
```
*Note: These will be mostly unused in the Electron build, but required for the server build.*

### Step 2: Update Dockerfile (Alpine)
Update `backend/Dockerfile` to install system Chromium for Alpine:

```dockerfile
# Add to "prod-deps" and "runner" stages
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

### Step 3: Create Abstract Browser Interface
Create `backend/src/lib/browser/BrowserService.js` to handle the environment split:

```javascript
class BrowserService {
  async fetchPageContent(url) {
    if (process.env.IS_ELECTRON) {
      return this.fetchWithElectron(url);
    } else {
      return this.fetchWithPuppeteer(url);
    }
  }

  async fetchWithElectron(url) {
    // Dynamic import to avoid bundling electron in server build
    const { BrowserWindow } = await import('electron');
    // Create invisible window, load URL, get content, destroy window
  }

  async fetchWithPuppeteer(url) {
     // Check pool, acquire instance, new page, get content, release
  }
}
```

### Step 4: Implement Puppeteer Provider (Server)
Create `backend/src/lib/browser/PuppeteerProvider.js`:
- Manages `@sparticuz/chromium` instance.
- Implements simple pooling (reuse browser instance).
- Handles resource cleanup (close browser after 5m idle).

### Step 5: Implement Electron Provider (Desktop)
Create `backend/src/lib/browser/ElectronProvider.js`:
- Uses `new BrowserWindow({ show: false, webPreferences: { offscreen: true } })`.
- Much faster as it shares the main process engine.
- Zero extra memory overhead compared to spawning a whole new Chromium.

### Step 6: Update WebFetch Logic
Update `webFetch.js` to use the fallback strategy:

```javascript
// 1. Try simple fetch + JSDOM
let content = await basicFetch(url);

// 2. Check for failure triggers
const isFailure = content.length < 300
  || content.includes("You need to enable JavaScript")
  || content.includes("<noscript>");

// 3. Fallback if needed
if (isFailure) {
  content = await browserService.fetchPageContent(url);
  // parse new content...
}
```

### Step 7: Testing & Validation
1. **Docker Test**:
   - Verify `apk` installation.
   - Test against a known SPA (e.g., `react.dev`).

2. **Electron Test**:
   - Verify it uses the native window.
   - Ensure the app doesn't crash or freeze during fetch.

## Resource Management

| Environment | Strategy | Memory Impact |
|-------------|----------|---------------|
| **Docker** | System Chromium + Puppeteer | ~100MB per active page |
| **Electron** | Native Window | Negligible (shared process) |
