import pino from 'pino';
import fs from 'fs';
import path from 'path';

const level = process.env.NODE_ENV === 'test' ? 'silent' : process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const pretty = (process.env.LOG_PRETTY ?? '').toLowerCase() !== 'false' && process.env.NODE_ENV !== 'production';

// Log retention configuration
const maxRetentionDays = parseInt(process.env.MAX_LOG_RETENTION_DAYS) || 3;

// Ensure logs directory exists
const logsDir = './logs';
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Configure pino to write to both stdout and file with date-based rotation
export const logger = pino({
  level,
  transport: {
    targets: [
      // Laravel-style file logging
      {
        target: path.resolve('./src/lib/custom-transport.js'),
        level,
        options: {
          destination: `./logs/app-${new Date().toISOString().slice(0, 10)}.log`,
          ignore: 'pid,hostname',
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

// Function to cleanup old log files
export function cleanupOldLogs() {
  const logsDir = './logs';

  try {
    // Check if logs directory exists
    if (!fs.existsSync(logsDir)) {
      return;
    }

    const files = fs.readdirSync(logsDir);
    const now = Date.now();
    const maxAge = maxRetentionDays * 24 * 60 * 60 * 1000; // Convert days to milliseconds

    let deletedCount = 0;
    for (const file of files) {
      // Only process app-YYYY-MM-DD.log files
      if (!file.startsWith('app-') || !file.endsWith('.log')) {
        continue;
      }

      const filePath = path.join(logsDir, file);
      const stats = fs.statSync(filePath);

      // Delete if file is older than retention period
      if (now - stats.mtime.getTime() > maxAge) {
        fs.unlinkSync(filePath);
        deletedCount++;
        logger.info(`Deleted old log file: ${file}`);
      }
    }

    if (deletedCount > 0) {
      logger.info(`Log cleanup completed: ${deletedCount} old log files deleted`);
    }
  } catch (error) {
    logger.error('Error during log cleanup:', error);
  }
}

// Run cleanup on startup (only in non-test environments)
if (process.env.NODE_ENV !== 'test') {
  cleanupOldLogs();

  // Run cleanup daily
  setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000); // 24 hours
}
