import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './env.js';
import { rateLimit } from './middleware/rateLimit.js';
import { sessionResolver } from './middleware/session.js';
import { chatRouter } from './routes/chat.js';
import { healthRouter } from './routes/health.js';
import { conversationsRouter } from './routes/conversations.js';

const app = express();

// Enhanced CORS for direct API calls
app.use(cors({ 
  origin: config.allowedOrigin, 
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization']
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));
app.use(rateLimit);
app.use(sessionResolver);

app.use(healthRouter);
app.use(conversationsRouter);
app.use(chatRouter);

app.use((err, req, res, next) => {
  console.error('Unhandled error', err);
  res.status(500).json({ error: 'internal_server_error' });
});

// Retention worker (Sprint 3)
import { getDb, retentionSweep } from './db/index.js';

if (config.persistence.enabled) {
  try {
    // Initialize DB once
    getDb();
    const intervalMs = 60 * 60 * 1000; // hourly
    setInterval(() => {
      try {
        const days = config.persistence.retentionDays;
        const result = retentionSweep({ days });
        if (result.deleted) {
          console.log(
            `[retention] deleted ${result.deleted} conversations older than ${days} days`
          );
        }
      } catch (e) {
        console.error('[retention] sweep error', e);
      }
    }, intervalMs);
    console.log(
      `[retention] worker started (every ${Math.round(intervalMs / 1000)}s, days=${config.persistence.retentionDays})`
    );
  } catch (e) {
    console.error('[retention] init error', e);
  }
}

app.listen(config.port, () => {
  console.log(`[server] listening on :${config.port}`);
});
