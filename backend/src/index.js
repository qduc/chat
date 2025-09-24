import express from 'express';
import cors from 'cors';
import { config } from './env.js';
import { rateLimit } from './middleware/rateLimit.js';
import { sessionResolver } from './middleware/session.js';
import { chatRouter } from './routes/chat.js';
import { healthRouter } from './routes/health.js';
import { conversationsRouter } from './routes/conversations.js';
import { providersRouter } from './routes/providers.js';
import { requestLogger, errorLogger } from './middleware/logger.js';
import { logger } from './logger.js';

const app = express();

// Enhanced CORS for direct API calls
app.use(cors({
  origin: config.allowedOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'x-session-id']
}));
app.use(express.json({ limit: '1mb' }));
app.use(sessionResolver);
app.use(requestLogger);
app.use(rateLimit);

app.use(healthRouter);
app.use(conversationsRouter);
app.use(providersRouter);
app.use(chatRouter);

app.use(errorLogger);
app.use((err, req, res, next) => {
  logger.error({ msg: 'Unhandled error', err });
  res.status(500).json({ error: 'internal_server_error' });
});

// Database initialization and retention worker (Sprint 3)
import { getDb } from './db/client.js';
import { retentionSweep } from './db/retention.js';

// Initialize database and run seeders on server startup
if (config.persistence.enabled && process.env.NODE_ENV !== 'test') {
  try {
    // Initialize DB once - this will run migrations and seeders
    const db = getDb();
    logger.info({ msg: 'database:initialized', seeders: 'completed' });

    // Set up retention worker
    const intervalMs = 60 * 60 * 1000; // hourly
    setInterval(() => {
      try {
        const days = config.persistence.retentionDays;
        const result = retentionSweep({ days });
        if (result.deleted) {
          logger.info(
            { msg: 'retention:deleted', deleted: result.deleted, days },
          );
        }
      } catch (e) {
        logger.error({ msg: 'retention:sweep_error', err: e });
      }
    }, intervalMs);
    logger.info({
      msg: 'retention:started',
      intervalSec: Math.round(intervalMs / 1000),
      days: config.persistence.retentionDays,
    });
  } catch (e) {
    logger.error({ msg: 'database:init_error', err: e });
  }
} else if (process.env.NODE_ENV !== 'test') {
  logger.info({ msg: 'database:disabled', persistence: false });
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, () => {
    logger.info({ msg: 'server:listening', port: config.port });
  });
}
