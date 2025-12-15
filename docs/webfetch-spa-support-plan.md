# WebFetch SPA Support Implementation Plan

## Overview

Upgrade the `webFetch` tool (`backend/src/lib/tools/webFetch.js`) with a browser engine to fetch content from Single Page Applications (SPAs) that require JavaScript execution.

**Current State**: The tool uses JSDOM which cannot execute JavaScript, limiting it to static HTML content.

**Goal**: Add browser fallback for SPAs while keeping JSDOM as the primary (lightweight) method.

## Recommended Approach

**Hybrid Strategy**: Try JSDOM first (current behavior), fall back to headless browser only when needed.

**Browser Engine**: chrome-aws-lambda with puppeteer-core (lightest option at ~80-120MB)

## Research Tasks (Do These First)

### 1. Research chrome-aws-lambda current status and alternatives
**Why**:
- chrome-aws-lambda may be deprecated or have maintenance issues
- Newer alternatives like @sparticuz/chromium might be better
- Need to verify 2025 compatibility with Node.js versions
- Check if there are lighter-weight alternatives

**What to research**:
- Current maintenance status of chrome-aws-lambda
- Alternative packages (@sparticuz/chromium, playwright-chromium-headless)
- Version compatibility with Node.js 20+
- Known issues in Docker environments

### 2. Research Chromium Docker optimization best practices
**Why**:
- Docker Chromium setup has specific requirements that evolve
- Security concerns (sandboxing, capabilities)
- Minimal dependency list changes over time
- Multi-stage build optimizations

**What to research**:
- Minimal Chromium dependencies for 2025 Debian/Alpine images
- Chrome flags for resource optimization in containers
- Security best practices (--no-sandbox implications)
- Font and locale requirements

### 3. Research browser pooling patterns and resource limits
**Why**:
- Browser pooling libraries may exist (generic-pool, etc.)
- Best practices for connection limits have evolved
- Memory leak prevention strategies
- Graceful shutdown patterns

**What to research**:
- Existing browser pooling libraries
- Recommended pool sizes for different memory constraints
- Browser instance lifecycle management
- Memory leak detection and prevention

### 4. Research modern SPA detection techniques
**Why**:
- New JavaScript frameworks emerge constantly
- Detection patterns need to catch Vue 3, React 18+, Svelte, etc.
- Meta tags and data attributes have evolved
- Better heuristics may exist

**What to research**:
- Current SPA framework detection methods
- Meta tags used by modern frameworks (2024-2025)
- DOM patterns that indicate client-side rendering
- Reliable heuristics (script-to-content ratio thresholds)

## Implementation Steps

### Step 1: Install Dependencies
```bash
./dev.sh exec backend npm install chrome-aws-lambda puppeteer-core --save
```

**Note**: After research, this may change to a different package.

### Step 2: Update Dockerfile
Update `backend/Dockerfile` to include Chromium and dependencies:

```dockerfile
# Install Chromium dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    fonts-liberation \
    libnss3 \
    libxss1 \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium environment variables
ENV CHROME_BIN=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

**Note**: Final dependency list should come from research task #2.

### Step 3: Create Browser Utility Module
Create `backend/src/lib/browserFetcher.js` with:

**Core functionality**:
- Browser initialization with optimized flags
- Browser instance pooling (reuse instances)
- Timeout handling (10s default)
- Resource cleanup
- Error handling

**Example structure**:
```javascript
import chromium from 'chrome-aws-lambda';
import puppeteer from 'puppeteer-core';

class BrowserPool {
  constructor(maxInstances = 2) {
    this.pool = [];
    this.maxInstances = maxInstances;
    this.idleTimeout = 5 * 60 * 1000; // 5 minutes
  }

  async acquireBrowser() {
    // Get or create browser instance
  }

  async releaseBrowser(browser) {
    // Return to pool or close if pool is full
  }

  async fetchWithBrowser(url, options = {}) {
    const browser = await this.acquireBrowser();
    try {
      const page = await browser.newPage();
      await page.goto(url, {
        waitUntil: 'networkidle0',
        timeout: options.timeout || 10000
      });
      const html = await page.content();
      await page.close();
      return html;
    } finally {
      await this.releaseBrowser(browser);
    }
  }

  async cleanup() {
    // Close all browser instances
  }
}

export const browserPool = new BrowserPool();
```

**Optimized Chromium flags** (adjust based on research):
```javascript
const args = [
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--disable-setuid-sandbox',
  '--no-sandbox',
  '--no-zygote',
  '--single-process',
  '--disable-accelerated-2d-canvas',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-sync',
  '--metrics-recording-only',
  '--mute-audio',
  '--no-first-run',
];
```

### Step 4: Add SPA Detection Logic
In `webFetch.js`, create function to detect if a page needs JavaScript:

```javascript
function isSPA(html, extractedContent) {
  // Check if extracted content is too short
  if (extractedContent.textContent.length < 300) {
    return true;
  }

  // Detect common SPA frameworks
  const spaIndicators = [
    /<div id="root"><\/div>/, // React
    /<div id="app"><\/div>/,  // Vue
    /ng-app=/,                 // Angular
    /__NEXT_DATA__/,           // Next.js
    /__nuxt/,                  // Nuxt
  ];

  for (const pattern of spaIndicators) {
    if (pattern.test(html)) {
      return true;
    }
  }

  // Check script-to-content ratio
  const scriptMatches = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
  const totalScriptLength = scriptMatches.join('').length;
  const contentLength = extractedContent.textContent.length;

  if (totalScriptLength > contentLength * 3) {
    // More script than content likely indicates SPA
    return true;
  }

  return false;
}
```

**Note**: Detection logic should be refined based on research task #4.

### Step 5: Implement Browser Fallback
Update the `handler` function in `webFetch.js`:

```javascript
import { browserPool } from './browserFetcher.js';

async function handler({ url, maxChars, targetHeading, headingRange, continuation_token }) {
  // ... existing continuation handling ...

  try {
    // Fetch the web page (existing code)
    const response = await fetch(url, { /* ... */ });
    let html = await streamResponse(response);

    // Try JSDOM extraction first
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;
    let extractedContent = tryExtractionStrategies(document);

    // Check if we need browser fallback
    let usedBrowser = false;
    let browserError = null;

    if (isSPA(html, extractedContent)) {
      try {
        // Re-fetch with browser
        html = await browserPool.fetchWithBrowser(url);

        // Re-extract with browser-rendered HTML
        const browserDom = new JSDOM(html, { url });
        extractedContent = tryExtractionStrategies(browserDom.window.document);
        usedBrowser = true;
      } catch (error) {
        // Browser failed, use JSDOM result with warning
        browserError = `Browser fallback failed: ${error.message}`;
      }
    }

    // ... rest of existing extraction logic ...

    return {
      url,
      title: extractedContent.title || 'Untitled',
      markdown: finalMarkdown,
      // ... existing fields ...
      ...(usedBrowser && { extractionMethod: 'browser' }),
      ...(browserError && { browserError }),
    };
  } catch (error) {
    // ... existing error handling ...
  }
}
```

### Step 6: Browser Instance Pooling
Implement efficient resource management in `browserFetcher.js`:

**Features**:
- Create browser pool manager (max 2-3 instances)
- Reuse browser instances across requests
- Implement idle timeout (close after 5 min inactivity)
- Add graceful shutdown on process exit

**Pool configuration**:
```javascript
const POOL_CONFIG = {
  maxInstances: 2,           // Max concurrent browsers
  idleTimeout: 5 * 60 * 1000, // 5 minutes
  pageTimeout: 10000,         // 10 seconds per page
};
```

**Graceful shutdown**:
```javascript
process.on('SIGTERM', async () => {
  await browserPool.cleanup();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await browserPool.cleanup();
  process.exit(0);
});
```

### Step 7: Testing & Validation
Test with various scenarios:

**Static HTML sites** (should use JSDOM):
- Wikipedia articles
- Documentation sites (MDN)
- News sites

**SPA sites** (should use browser):
- React docs (react.dev)
- Vue docs (vuejs.org)
- Modern web apps

**Hybrid sites** (SSR with client-side hydration):
- Next.js sites
- Nuxt sites

**Monitoring**:
- Log browser usage for each request
- Track memory usage in Docker container
- Monitor browser pool statistics
- Verify no memory leaks over time

**Test commands**:
```bash
# Monitor container memory
docker stats

# Check browser usage logs
./dev.sh logs backend | grep "browser"

# Test with specific URLs
curl -X POST http://localhost:8080/api/tools/web_fetch \
  -H "Content-Type: application/json" \
  -d '{"url": "https://react.dev"}'
```

## Key Design Decisions

### Fallback Trigger
Content length < 300 chars OR explicit SPA detection (framework patterns)

### Resource Limits
- Max 2 concurrent browser instances
- 10s page load timeout
- 5min idle timeout before closing browser
- Single process mode for Docker

### Error Handling
- Browser timeout → return partial JSDOM result with error message
- Browser crash → fallback to JSDOM result
- Always return something (never fail completely)

### Metadata Tracking
Add to response object:
- `extractionMethod: 'browser'` when browser is used
- `browserError: string` when browser fallback fails
- Log browser usage for monitoring

## Resource Comparison

| Option | Memory | Binary Size | Notes |
|--------|--------|-------------|-------|
| chrome-aws-lambda | 80-120MB | ~50MB compressed | Optimized for serverless |
| puppeteer-core + optimized flags | 100-150MB | varies | Good control over flags |
| playwright-chromium | 150-200MB | ~80MB | Modern API |
| Full Puppeteer/Playwright | 200-400MB+ | 280MB+ | Overkill |

## Alternative Approaches Considered

### Option 1: Always use browser
**Pros**: Consistent behavior, handles all sites
**Cons**: High resource usage, slower, expensive

### Option 2: Playwright instead of Puppeteer
**Pros**: More modern API, better TypeScript support
**Cons**: Heavier, more dependencies

### Option 3: External service (Browserless.io, etc.)
**Pros**: No local resources, scalable
**Cons**: External dependency, costs, latency

## Notes for Implementation

1. **Test in development first**: Use `./dev.sh up --build` to test Docker changes
2. **Monitor memory**: Watch Docker stats during testing
3. **Consider toggle**: Add environment variable to disable browser fallback if needed
4. **Logging**: Add detailed logging for debugging browser issues
5. **Timeouts**: Be aggressive with timeouts to prevent hanging
6. **Caching**: Consider caching browser-rendered content (separate from current cache)

## Future Enhancements

1. **Smart detection**: Learn from usage which sites need browser
2. **Prewarming**: Keep one browser instance warm for faster first use
3. **Screenshot support**: Capture visual content from SPAs
4. **JavaScript execution**: Support custom scripts for data extraction
5. **Cookie/auth support**: Handle authenticated content
6. **Proxy support**: Route browser through proxy for privacy

## References

- Current webFetch tool: `/Users/qduc/src/chat/backend/src/lib/tools/webFetch.js`
- Backend Dockerfile: `/Users/qduc/src/chat/backend/Dockerfile`
- Project docs: `/Users/qduc/src/chat/docs/`

---

**Status**: Planning phase - research needed before implementation

**Last Updated**: 2025-12-15
