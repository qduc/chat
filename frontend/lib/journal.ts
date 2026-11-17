/**
 * The signed-in user's Journal (memory) entries.
 */
import { httpClient, HttpError } from './http';

export interface JournalEntry {
  id: number;
  model_name: string;
  content: string;
  created_at: string;
}

export interface JournalPage {
  entries: JournalEntry[];
  page: number;
  page_size: number;
  has_more: boolean;
}

export const JOURNAL_PAGE_SIZE = 20;

/**
 * Fetch one page of journal entries. Returns null when the endpoint does not
 * exist (404), so callers can hide the feature instead of showing an error.
 */
export async function fetchJournalPage(
  page: number,
  pageSize: number = JOURNAL_PAGE_SIZE
): Promise<JournalPage | null> {
  try {
    const res = await httpClient.get<JournalPage>(`/v1/journal?page=${page}&page_size=${pageSize}`);
    const data = res.data;
    return {
      entries: Array.isArray(data?.entries) ? data.entries : [],
      page: typeof data?.page === 'number' ? data.page : page,
      page_size: typeof data?.page_size === 'number' ? data.page_size : pageSize,
      has_more: Boolean(data?.has_more),
    };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

export async function deleteJournalEntry(id: number): Promise<void> {
  await httpClient.delete(`/v1/journal/${id}`);
}
