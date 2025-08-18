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

app.use(cors({ origin: config.allowedOrigin, credentials: false }));
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

app.listen(config.port, () => {
  console.log(`[server] listening on :${config.port}`);
});
