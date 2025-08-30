import 'dotenv/config';

const required = [
  // Provider config is flexible; default remains OpenAI-compatible
  'DEFAULT_MODEL',
  'PORT',
  'RATE_LIMIT_WINDOW_SEC',
  'RATE_LIMIT_MAX',
  'ALLOWED_ORIGIN',
];

for (const key of required) {
  if (!process.env[key]) {
    console.warn(`[env] Missing ${key}.`);
  }
}

const bool = (v, def = false) => {
  if (v === undefined) return def;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
};

export const config = {
  // Provider selection (default to openai for backward-compat)
  provider: process.env.PROVIDER || 'openai',
  // Backward-compat: legacy OpenAI fields still present
  openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  openaiApiKey: process.env.OPENAI_API_KEY,
  // Generic provider config; falls back to OpenAI values
  providerConfig: {
    baseUrl: process.env.PROVIDER_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.PROVIDER_API_KEY || process.env.OPENAI_API_KEY,
    headers: (() => {
      try {
        return process.env.PROVIDER_HEADERS_JSON ? JSON.parse(process.env.PROVIDER_HEADERS_JSON) : undefined;
      } catch (e) {
        console.warn('[env] Invalid PROVIDER_HEADERS_JSON; expected JSON');
        return undefined;
      }
    })(),
  },
  defaultModel: process.env.DEFAULT_MODEL || 'gpt-4.1-mini',
  titleModel: process.env.TITLE_MODEL || 'gpt-4.1-mini',
  port: Number(process.env.PORT) || 3001,
  rate: {
    windowSec: Number(process.env.RATE_LIMIT_WINDOW_SEC) || 60,
    max: Number(process.env.RATE_LIMIT_MAX) || 50,
  },
  allowedOrigin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
  persistence: {
    enabled: bool(process.env.PERSIST_TRANSCRIPTS, true),
    dbUrl: process.env.DB_URL || '',
    maxConversationsPerSession:
      Number(process.env.MAX_CONVERSATIONS_PER_SESSION) || 100,
    maxMessagesPerConversation:
      Number(process.env.MAX_MESSAGES_PER_CONVERSATION) || 1000,
    historyBatchFlushMs: Number(process.env.HISTORY_BATCH_FLUSH_MS) || 250,
    retentionDays: Number(process.env.RETENTION_DAYS) || 30,
  },
};
