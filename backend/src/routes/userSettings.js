import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getUserSetting, upsertUserSetting, deleteUserSetting } from '../db/userSettings.js';

export function createUserSettingsRouter() {
  const router = Router();
  router.use(authenticateToken);

  // Generic user setting key access for supported search tools.
  // Query param `name` must be one of: 'tavily', 'exa', 'searxng'.
  function mapNameToKey(name) {
    const n = String(name || '').toLowerCase();
    switch (n) {
      case 'tavily':
      case 'tavily_api_key':
        return 'tavily_api_key';
      case 'exa':
      case 'exa_api_key':
        return 'exa_api_key';
      case 'searxng':
      case 'searxng_api_key':
        return 'searxng_api_key';
      default:
        throw new Error(`unsupported key name: ${String(name)}`);
    }
  }

  // Get a user-scoped setting for a supported key
  router.get('/v1/user-settings/search-api-key', (req, res) => {
    try {
      const userId = req.user.id;
      const name = req.query?.name;
      if (!name) return res.status(400).json({ error: 'invalid_request', message: 'name query parameter is required and must be one of: tavily, exa, searxng' });
      const keyName = mapNameToKey(name);
      const row = getUserSetting(userId, keyName);
      res.json({ key: row ? row.value : null, name: keyName });
    } catch (err) {
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });

  // Upsert a user-scoped key for a supported tool
  router.put('/v1/user-settings/search-api-key', (req, res) => {
    try {
      const userId = req.user.id;
      const key = req.body?.key ?? null;
      const name = req.query?.name;
      if (!name) return res.status(400).json({ error: 'invalid_request', message: 'name query parameter is required and must be one of: tavily, exa, searxng' });
      if (key === null || key === undefined) {
        return res.status(400).json({ error: 'invalid_request', message: 'key is required in body' });
      }
      const keyName = mapNameToKey(name);
      upsertUserSetting(userId, keyName, String(key));
      res.status(200).json({ success: true, name: keyName });
    } catch (err) {
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });

  // Delete a user-scoped key
  router.delete('/v1/user-settings/search-api-key', (req, res) => {
    try {
      const userId = req.user.id;
      const name = req.query?.name;
      if (!name) return res.status(400).json({ error: 'invalid_request', message: 'name query parameter is required and must be one of: tavily, exa, searxng' });
      const keyName = mapNameToKey(name);
      const ok = deleteUserSetting(userId, keyName);
      if (!ok) return res.status(404).json({ error: 'not_found' });
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });

  return router;
}

export const userSettingsRouter = createUserSettingsRouter();
