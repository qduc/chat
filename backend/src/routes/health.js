import { Router } from 'express';
import { config } from '../env.js';

export const healthRouter = Router();

healthRouter.get(['/health', '/healthz'], (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    provider: 'openai-compatible',
    model: config.defaultModel,
    persistence: {
      enabled: !!config.persistence.enabled,
      retentionDays: config.persistence.retentionDays,
    },
  });
});
