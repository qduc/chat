import pino from 'pino';

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const pretty = (process.env.LOG_PRETTY ?? '').toLowerCase() !== 'false' && process.env.NODE_ENV !== 'production';

// Configure pino. Pretty transport only in non-production by default.
export const logger = pino({
  level,
  transport: pretty
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          singleLine: false,
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  redact: {
    // Best-effort redactions for common sensitive fields
    paths: [
      'req.headers.authorization',
      'headers.authorization',
      'config.openaiApiKey',
      'OPENAI_API_KEY',
      'body.apiKey',
    ],
    remove: true,
  },
});
