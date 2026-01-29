# Plan: Clean Up config.providerConfig Design

## Problem

`config.providerConfig` conflates provider-specific fields with truly shared config:

```javascript
providerConfig: {
  baseUrl: OPENAI_BASE_URL,      // Provider-specific - PROBLEMATIC
  apiKey: null,                   // Provider-specific - PROBLEMATIC
  headers: providerHeaders,       // Provider-specific - PROBLEMATIC
  timeoutMs: 10000,              // Truly shared - KEEP
  modelFetchTimeoutMs: 3000,     // Truly shared - KEEP
  streamTimeoutMs: 300000,       // Truly shared - KEEP
  retry: { ... },                // Truly shared - KEEP
}
```

This causes bugs where non-OpenAI providers (Gemini, Anthropic) incorrectly fall back to OpenAI's base URL, requiring defensive URL rejection code.

## Solution

Remove provider-specific fields from global config. Each provider class already has `static defaultBaseUrl` - use that as the sole source of truth.

---

## Implementation Steps

### 1. Update env.js

**File:** `backend/src/env.js`

Remove:
- Lines 39-42: `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, `providerHeaders` constants
- Lines 55-59: Legacy fields `openaiBaseUrl`, `openaiApiKey`, `anthropicBaseUrl`, `anthropicApiKey`
- Lines 62-64: `baseUrl`, `apiKey`, `headers` from `providerConfig`

Keep in `providerConfig`:
- `timeoutMs`, `modelFetchTimeoutMs`, `streamTimeoutMs`, `retry`

### 2. Simplify providers/index.js

**File:** `backend/src/lib/providers/index.js`

**getProviderDefaults()** (lines 31-54) - Simplify to:
```javascript
function getProviderDefaults(providerType) {
  const type = (providerType || 'openai').toLowerCase();
  const ProviderClass = selectProviderConstructor(type);
  return {
    baseUrl: ProviderClass.defaultBaseUrl,
    apiKey: null,  // API key only from database
  };
}
```

**resolveProviderSettings()** (lines 56-123) - Simplify fallback chains:
- Line 88: `getProviderDefaults(providerType, config)` → `getProviderDefaults(providerType)`
- Lines 89-91: Remove `config?.providerConfig?.baseUrl || config?.openaiBaseUrl` from chain
- Line 97: Remove `config?.providerConfig?.apiKey || config?.openaiApiKey` fallbacks
- Lines 110-118: Simplify env fallback to just use `defaults.baseUrl`

### 3. Simplify Provider Classes

**OpenAIProvider** (`backend/src/lib/providers/openaiProvider.js`):
- `get apiKey()` (line 98): Just `return this.settings?.apiKey;`
- `get baseUrl()` (lines 101-108): Simplify to `this.settings?.baseUrl || OpenAIProvider.defaultBaseUrl`
- `get defaultHeaders()` (lines 110-115): Just `return { ...(this.settings?.headers || {}) };`

**AnthropicProvider** (`backend/src/lib/providers/anthropicProvider.js`):
- `get apiKey()` (line 58): Just `return this.settings?.apiKey;`
- `get baseUrl()` (lines 61-83): Remove defensive URL rejection, simplify to `this.settings?.baseUrl || AnthropicProvider.defaultBaseUrl`
- `get defaultHeaders()` (lines 85-89): Just `return { ...(this.settings?.headers || {}) };`

**GeminiProvider** (`backend/src/lib/providers/geminiProvider.js`):
- `get apiKey()` (line 73): Just `return this.settings?.apiKey;`
- `get baseUrl()` (lines 76-91): Remove defensive URL rejection, simplify to `this.settings?.baseUrl || GeminiProvider.defaultBaseUrl`
- `get defaultHeaders()` (lines 93-97): Just `return { ...(this.settings?.headers || {}) };`

### 4. Update Seeder

**File:** `backend/src/db/seeders/000-env-provider.js`

Import `selectProviderConstructor` and use static defaults:
```javascript
import { selectProviderConstructor } from '../../lib/providers/index.js';

const providerType = (config.provider || 'openai').toLowerCase();
const ProviderClass = selectProviderConstructor(providerType);
const baseUrl = ProviderClass.defaultBaseUrl;
const apiKey = null;  // User configures via UI
const headersObj = {};
```

### 5. Update Tests

**Files to update:**
- `backend/__tests__/providers.interface.test.js` - Remove tests for config fallback behavior (no longer needed)
- `backend/__tests__/anthropic_provider.test.js` - Pass apiKey via settings, not config
- `backend/__tests__/chat_proxy.format.test.js` - Create test providers in DB instead of mutating config
- `backend/test_utils/chatProxyTestUtils.js` - Refactor to use database providers

### 6. Minor Cleanup

**File:** `backend/src/logger.js` (line 61)
- Remove `'config.openaiApiKey'` from redaction paths

---

## Files to Modify

| File | Changes |
|------|---------|
| `backend/src/env.js` | Remove provider-specific fields |
| `backend/src/lib/providers/index.js` | Simplify resolution logic |
| `backend/src/lib/providers/openaiProvider.js` | Simplify getters |
| `backend/src/lib/providers/anthropicProvider.js` | Remove URL rejection, simplify |
| `backend/src/lib/providers/geminiProvider.js` | Remove URL rejection, simplify |
| `backend/src/db/seeders/000-env-provider.js` | Use static defaults |
| `backend/__tests__/providers.interface.test.js` | Update tests |
| `backend/__tests__/anthropic_provider.test.js` | Update mock config |
| `backend/__tests__/chat_proxy.format.test.js` | Use DB providers |
| `backend/test_utils/chatProxyTestUtils.js` | Refactor test utilities |
| `backend/src/logger.js` | Remove unused redaction |

---

## Verification

1. **Run tests:** `./dev.sh test:backend`
2. **Manual testing:**
   - Start app: `./dev.sh up`
   - Create new user, verify default provider is created with correct base URL
   - Add Gemini provider, verify it uses Gemini's URL (not OpenAI's)
   - Add Anthropic provider, verify it uses Anthropic's URL
   - Test model fetching for all provider types
3. **Background refresh:** Let the hourly model cache refresh run, verify Gemini models fetch correctly

---

## Notes

- After this change, API keys must be configured via UI (database-first architecture)
- The seeder creates a provider entry with default URL; users add their API key
- This removes ~50 lines of defensive URL rejection code from providers
