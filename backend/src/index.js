import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { config } from './env.js';
import { rateLimit } from './middleware/rateLimit.js';
import { sessionResolver } from './middleware/session.js';
import { chatRouter } from './routes/chat.js';
import { healthRouter } from './routes/health.js';
import { conversationsRouter } from './routes/conversations.js';
import { providersRouter } from './routes/providers.js';
import { systemPromptsRouter } from './routes/systemPrompts.js';
import { imagesRouter } from './routes/images.js';
import { filesRouter } from './routes/files.js';
import authRouter from './routes/auth.js';
import { userSettingsRouter } from './routes/userSettings.js';
import { requestLogger } from './middleware/logger.js';
import { logger } from './logger.js';

const app = express();

// Enhanced CORS for direct API calls
app.use(cors({
  origin: config.allowedOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'x-session-id']
}));
app.use(express.json({ limit: '15mb' }));
app.use(sessionResolver);
// Removed getUserContext - authentication now handled per-router
app.use(requestLogger);
app.use(rateLimit);

if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });
}

app.use(healthRouter);

const apiRouter = express.Router();
apiRouter.use('/v1/auth', authRouter);
apiRouter.use(imagesRouter); // Must be before auth-protected routers
apiRouter.use(filesRouter); // File upload routes
apiRouter.use(conversationsRouter);
apiRouter.use(providersRouter);
apiRouter.use(userSettingsRouter);
apiRouter.use(systemPromptsRouter);
apiRouter.use(chatRouter);

app.use('/api', apiRouter);

import { exceptionHandler } from './middleware/exceptionHandler.js';

app.use(exceptionHandler);

// Serve static files from the React app
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const buildPath = path.join(__dirname, '../public');

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(buildPath));

  // The "catchall" handler: for any request that doesn't
  // match one above, send back React's index.html file.
  app.get('*', (req, res) => {
    res.sendFile(path.join(buildPath, 'index.html'));
  });
}

// Database initialization and retention worker (Sprint 3)
import { getDb } from './db/client.js';
import { retentionSweep } from './db/retention.js';

// Initialize database and run seeders on server startup
if (config.persistence.enabled && process.env.NODE_ENV !== 'test') {
  try {
    // Initialize DB once - this will run migrations and seeders
    getDb();
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
