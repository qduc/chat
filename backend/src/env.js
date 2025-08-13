import 'dotenv/config';

const required = [
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'DEFAULT_MODEL',
  'PORT',
  'RATE_LIMIT_WINDOW_SEC',
  'RATE_LIMIT_MAX',
  'ALLOWED_ORIGIN'
];

for (const key of required) {
  if (!process.env[key]) {
    console.warn(`[env] Missing ${key}.`);
  }
}

export const config = {
  openaiBaseUrl: process.env.OPENAI_BASE_URL,
  openaiApiKey: process.env.OPENAI_API_KEY,
  defaultModel: process.env.DEFAULT_MODEL || 'gpt-4.1-mini',
  port: Number(process.env.PORT) || 3001,
  rate: {
    windowSec: Number(process.env.RATE_LIMIT_WINDOW_SEC) || 60,
    max: Number(process.env.RATE_LIMIT_MAX) || 50,
  },
  allowedOrigin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000'
};
