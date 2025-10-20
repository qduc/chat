import { getDb } from './client.js';

export function getAllUserSettings(userId) {
  const db = getDb();
  // Only return supported keys for now
  const rows = db.prepare(`SELECT name, value FROM user_settings WHERE user_id = ? AND name IN ('tavily_api_key', 'exa_api_key', 'searxng_api_key')`).all(userId);
  const result = {
    tavily_api_key: null,
    exa_api_key: null,
    searxng_api_key: null,
  };
  for (const row of rows) {
    if (row.name in result) {
      result[row.name] = row.value;
    }
  }
  return result;
}
