import pino from 'pino';

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const pretty = (process.env.LOG_PRETTY ?? '').toLowerCase() !== 'false' && process.env.NODE_ENV !== 'production';

// Configure pino to write to both stdout and file with date-based rotation
export const logger = pino({
  level,
  transport: {
    targets: [
      // Always write JSON logs to file with date-based filenames
      {
        target: './lib/dailyRotatingFileTransport.js',
        level,
        options: {
          file: './logs/app',
          extension: '.log',
        },
      },
      // Pretty console output in development, plain JSON in production
      pretty
        ? {
            target: 'pino-pretty',
            level,
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              singleLine: false,
              ignore: 'pid,hostname',
              destination: 1, // stdout
            },
          }
        : {
            target: 'pino/file',
            level,
            options: {
              destination: 1, // stdout
            },
          },
    ],
  },
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
