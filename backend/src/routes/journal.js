import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { deleteJournalEntry, listJournalEntriesPage } from '../db/journal.js';
import { logger } from '../logger.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Positive integer from a query/path value: `fallback` when absent, null when invalid. */
function parsePositiveInt(value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

/**
 * The user's Journal ("memory") entries, written by the journal tool. Every
 * query is scoped to the authenticated user.
 */
export function createJournalRouter() {
  const router = Router();
  router.use(authenticateToken);

  // GET /v1/journal?page=1&page_size=20 (newest first; page_size capped at 100)
  router.get('/v1/journal', (req, res) => {
    const page = parsePositiveInt(req.query.page, 1);
    const requestedSize = parsePositiveInt(req.query.page_size, DEFAULT_PAGE_SIZE);
    if (page === null || requestedSize === null) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'page and page_size must be positive integers',
      });
    }
    const pageSize = Math.min(requestedSize, MAX_PAGE_SIZE);
    try {
      const { entries, hasMore } = listJournalEntriesPage(req.user.id, page, pageSize);
      return res.json({
        entries: entries.map((entry) => ({
          id: Number(entry.id),
          model_name: entry.model_name,
          content: entry.content,
          created_at: entry.created_at,
        })),
        page,
        page_size: pageSize,
        has_more: hasMore,
      });
    } catch (err) {
      logger.error('[journal] list error', err);
      return res
        .status(500)
        .json({ error: 'internal_server_error', message: 'Failed to list journal entries' });
    }
  });

  // DELETE /v1/journal/:id -> 204; 404 when missing or owned by another user
  router.delete('/v1/journal/:id', (req, res) => {
    const id = parsePositiveInt(req.params.id, null);
    if (id === null) {
      return res.status(404).json({ error: 'not_found', message: 'Journal entry not found' });
    }
    try {
      const deleted = deleteJournalEntry(req.user.id, id);
      if (!deleted) {
        return res.status(404).json({ error: 'not_found', message: 'Journal entry not found' });
      }
      return res.status(204).end();
    } catch (err) {
      logger.error('[journal] delete error', err);
      return res
        .status(500)
        .json({ error: 'internal_server_error', message: 'Failed to delete journal entry' });
    }
  });

  return router;
}

export const journalRouter = createJournalRouter();
