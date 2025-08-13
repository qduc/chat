import { Router } from 'express';
import { config } from '../env.js';

export const healthRouter = Router();

healthRouter.get('/healthz', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), provider: 'openai-compatible', model: config.defaultModel });
});
