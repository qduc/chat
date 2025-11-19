
import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { upsertUserSetting } from '../db/userSettings.js';
import { getAllUserSettings } from '../db/getAllUserSettings.js';

const router = Router();
router.use(authenticateToken);

export function createUserSettingsRouter() {
  // Unified update route for all keys
  router.put('/v1/user-settings', (req, res) => {
    try {
      const userId = req.user.id;
      const body = req.body || {};
      const supportedKeys = ['tavily_api_key', 'exa_api_key', 'searxng_api_key', 'searxng_base_url'];
      const updated = {};
      for (const key of supportedKeys) {
        if (Object.hasOwn(body, key)) {
          const value = body[key];
          const normalized = typeof value === 'string' ? value.trim() : value;
          const storedValue = normalized === '' ? null : normalized;
          upsertUserSetting(userId, key, storedValue);
          updated[key] = storedValue;
        }
      }
      res.status(200).json({ success: true, updated });
    } catch (err) {
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });
  // Get all user settings for the authenticated user
  router.get('/v1/user-settings', (req, res) => {
    try {
      const userId = req.user.id;
      const settings = getAllUserSettings(userId);
      res.json(settings);
    } catch (err) {
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });

  return router;
}

export const userSettingsRouter = createUserSettingsRouter();
