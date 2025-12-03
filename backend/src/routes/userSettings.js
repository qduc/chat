
import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { upsertUserSetting } from '../db/userSettings.js';
import { getAllUserSettings } from '../db/getAllUserSettings.js';
import { getUserMaxToolIterations, updateUserMaxToolIterations } from '../db/users.js';

export function createUserSettingsRouter() {
  const router = Router();
  router.use(authenticateToken);

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
      // Handle max_tool_iterations separately (stored in users table)
      if (Object.hasOwn(body, 'max_tool_iterations')) {
        const value = body.max_tool_iterations;
        if (typeof value === 'number' && !isNaN(value)) {
          const success = updateUserMaxToolIterations(userId, value);
          if (success) {
            updated.max_tool_iterations = Math.max(1, Math.min(50, Math.floor(value)));
          }
        } else {
          return res.status(400).json({
            error: 'invalid_value',
            message: 'max_tool_iterations must be a number between 1 and 50'
          });
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
      // Add max_tool_iterations from users table
      const maxIterations = getUserMaxToolIterations(userId);
      settings.max_tool_iterations = maxIterations;
      res.json(settings);
    } catch (err) {
      res.status(500).json({ error: 'internal_server_error', message: err.message });
    }
  });

  return router;
}

export const userSettingsRouter = createUserSettingsRouter();
