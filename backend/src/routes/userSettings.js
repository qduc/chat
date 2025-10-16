import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getUserSetting, upsertUserSetting, deleteUserSetting } from '../db/userSettings.js';

export function createUserSettingsRouter() {
  const router = Router();
  router.use(authenticateToken);

  // Get search API key for current user
  router.get('/v1/user-settings/search-api-key', (req, res) => {
    try {
      const userId = req.user.id;
      const row = getUserSetting(userId, 'search_api_key');
      res.json({ key: row ? row.value : null });
    } catch (err) {
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });

  // Upsert search API key
  router.put('/v1/user-settings/search-api-key', (req, res) => {
    try {
      const userId = req.user.id;
      const key = req.body?.key ?? null;
      if (key === null || key === undefined) {
        return res.status(400).json({ error: 'invalid_request', message: 'key is required in body' });
      }
      upsertUserSetting(userId, 'search_api_key', String(key));
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });

  // Delete search API key
  router.delete('/v1/user-settings/search-api-key', (req, res) => {
    try {
      const userId = req.user.id;
      const ok = deleteUserSetting(userId, 'search_api_key');
      if (!ok) return res.status(404).json({ error: 'not_found' });
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });

  return router;
}

export const userSettingsRouter = createUserSettingsRouter();
