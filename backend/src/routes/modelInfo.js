import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getModelInfo } from '../lib/modelCatalog/pricing.ts';
import { resolvePricingTarget } from '../lib/modelCatalog/providerTarget.ts';
import { logger } from '../logger.js';

/**
 * Static model metadata from the vendored model catalog: context window,
 * output limit and per-MTok prices. Unknown models answer 200 with nulls.
 */
export function createModelInfoRouter() {
  const router = Router();
  router.use(authenticateToken);

  // GET /v1/models/info?model=<model id>&provider=<provider id, optional>
  router.get('/v1/models/info', (req, res) => {
    const model = typeof req.query.model === 'string' ? req.query.model.trim() : '';
    if (!model) {
      return res
        .status(400)
        .json({ error: 'invalid_request', message: 'model query parameter is required' });
    }
    const providerId = typeof req.query.provider === 'string' ? req.query.provider.trim() : '';
    try {
      // The provider only steers which catalog entry wins. It is looked up
      // among the caller's own providers; unknown ids are ignored.
      const target = resolvePricingTarget(providerId || null, req.user.id);
      const info = getModelInfo(target.catalogProvider, model);
      // Local servers are never catalog-priced (see providerTarget.ts).
      return res.json(target.catalogPriced ? info : { ...info, pricing: null });
    } catch (err) {
      logger.error('[models/info] error', err);
      return res
        .status(500)
        .json({ error: 'internal_server_error', message: 'Failed to look up model info' });
    }
  });

  return router;
}

export const modelInfoRouter = createModelInfoRouter();
