import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
// Removed unused imports after legacy route cleanup

export function createUserSettingsRouter() {
  // Unified update route for all keys
  router.put('/v1/user-settings', (req, res) => {
    try {
      const userId = req.user.id;
      const body = req.body || {};
      const supportedKeys = ['tavily_api_key', 'exa_api_key', 'searxng_api_key'];
      const updated = {};
      for (const key of supportedKeys) {
        if (Object.hasOwn(body, key)) {
          const value = body[key];
          const { upsertUserSetting } = require('../db/userSettings.js');
          upsertUserSetting(userId, key, value);
          updated[key] = value;
        }
      }
      res.status(200).json({ success: true, updated });
    } catch (err) {
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });
  // Get all user settings for the authenticated user
  const { getAllUserSettings } = require('../db/getAllUserSettings.js');

  router.get('/v1/user-settings', (req, res) => {
    try {
      const userId = req.user.id;
      const settings = getAllUserSettings(userId);
      res.json(settings);
    } catch (err) {
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });
  const router = Router();
  router.use(authenticateToken);

  // Generic user setting key access for supported search tools.
  // Query param `name` must be one of: 'tavily', 'exa', 'searxng'.
  // Removed unused mapNameToKey after legacy route cleanup


  return router;
}

export const userSettingsRouter = createUserSettingsRouter();
