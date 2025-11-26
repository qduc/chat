import 'dotenv/config';
import { logger } from './logger.js';

// Detect test environments (Jest sets JEST_WORKER_ID; NODE_ENV may be 'test')
const isTest = process.env.NODE_ENV === 'test' || typeof process.env.JEST_WORKER_ID !== 'undefined';

const required = [
  'PORT',
  'RATE_LIMIT_WINDOW_SEC',
  'RATE_LIMIT_MAX',
  'ALLOWED_ORIGIN',
  // Auth config
  'JWT_SECRET',
];

for (const key of required) {
  if (!process.env[key]) {
    // Avoid noisy warnings during automated tests
    if (!isTest) logger.warn(`[env] Missing ${key}.`);
  }
}

const bool = (v, def = false) => {
  if (v === undefined) return def;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
};

const DEFAULT_MODEL = 'gpt-4.1-mini';
const DEFAULT_TITLE_MODEL = 'gpt-4.1-mini';
const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

const providerHeaders = undefined;

export const config = {
  // Provider selection (default to openai for backward-compat)
  provider: 'openai',
  // Backward-compat: legacy OpenAI fields still present (now static defaults)
  openaiBaseUrl: OPENAI_BASE_URL,
  openaiApiKey: null,
  // Anthropic provider overrides
  anthropicBaseUrl: ANTHROPIC_BASE_URL,
  anthropicApiKey: null,
  // Generic provider config; falls back to OpenAI values
  providerConfig: {
    baseUrl: OPENAI_BASE_URL,
    apiKey: null,
    headers: providerHeaders,
    timeoutMs: Number(process.env.PROVIDER_TIMEOUT_MS) || 10000, // 10 second default for provider operations
    modelFetchTimeoutMs: Number(process.env.PROVIDER_MODEL_FETCH_TIMEOUT_MS) || 3000, // 3 second default for model fetching
    streamTimeoutMs: Number(process.env.PROVIDER_STREAM_TIMEOUT_MS) || 300000, // 300 second default for streaming operations
  },
  defaultModel: DEFAULT_MODEL,
  titleModel: DEFAULT_TITLE_MODEL,
  port: Number(process.env.PORT) || 3001,
  rate: {
    windowSec: Number(process.env.RATE_LIMIT_WINDOW_SEC) || 60,
    max: Number(process.env.RATE_LIMIT_MAX) || 500,
  },
  allowedOrigin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
  persistence: {
    enabled: bool(process.env.PERSIST_TRANSCRIPTS, true),
    dbUrl: process.env.DB_URL || '',
    maxConversationsPerSession: Number(process.env.MAX_CONVERSATIONS_PER_SESSION) || 100,
    maxMessagesPerConversation: Number(process.env.MAX_MESSAGES_PER_CONVERSATION) || 1000,
    historyBatchFlushMs: Number(process.env.HISTORY_BATCH_FLUSH_MS) || 250,
    retentionDays: Number(process.env.RETENTION_DAYS) || 30,
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'development-secret-key-change-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
};
