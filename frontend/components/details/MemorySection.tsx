import React, { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { DetailsSection } from './DetailsSection';
import { ConfirmDialog } from './ConfirmDialog';
import { Button, IconButton } from '../ui/Button';
import { deleteJournalEntry, fetchJournalPage, type JournalEntry } from '../../lib/journal';
import { formatRelativeTime } from '../../lib/detailsFormat';

interface MemorySectionProps {
  open: boolean;
  onToggle: () => void;
}

type Status = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';

/**
 * The user's Journal entries. Loaded the first time the section is opened.
 * Hides itself when the journal endpoint does not exist (404).
 */
export function MemorySection({ open, onToggle }: MemorySectionProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<JournalEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  const load = useCallback(async (nextPage: number) => {
    try {
      const result = await fetchJournalPage(nextPage);
      if (!result) {
        setStatus('unavailable');
        return;
      }
      setEntries((prev) => (nextPage === 1 ? result.entries : [...prev, ...result.entries]));
      setPage(nextPage);
      setHasMore(result.has_more);
      setStatus('ready');
    } catch {
      setStatus((prev) => (prev === 'ready' ? prev : 'error'));
    }
  }, []);

  useEffect(() => {
    if (!open || status !== 'idle') return;
    const timer = setTimeout(() => {
      setStatus('loading');
      void load(1);
    }, 0);
    return () => clearTimeout(timer);
  }, [open, status, load]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    await load(page + 1);
    setLoadingMore(false);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteJournalEntry(deleteTarget.id);
      setEntries((prev) => prev.filter((entry) => entry.id !== deleteTarget.id));
      setDeleteError(false);
    } catch {
      setDeleteError(true);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  if (status === 'unavailable') return null;

  const count =
    status === 'ready' && entries.length > 0 ? `${entries.length}${hasMore ? '+' : ''}` : undefined;

  return (
    <>
      <DetailsSection title="Memory" count={count} open={open} onToggle={onToggle}>
        <div className="flex flex-col gap-2 px-1 pt-1 pb-2 text-xs">
          {status === 'idle' || status === 'loading' ? (
            <p className="text-fg-subtle" role="status">
              Loading memory…
            </p>
          ) : null}
          {status === 'error' ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-fg-subtle" role="status">
                Memory couldn&rsquo;t be loaded right now.
              </p>
              <Button variant="ghost" size="sm" onClick={() => setStatus('idle')}>
                Try again
              </Button>
            </div>
          ) : null}
          {status === 'ready' && entries.length === 0 ? (
            <p className="text-fg-subtle">Nothing saved to memory yet.</p>
          ) : null}
          {deleteError ? (
            <p className="text-danger" role="alert">
              That memory couldn&rsquo;t be deleted. Try again.
            </p>
          ) : null}
          {entries.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {entries.map((entry) => (
                <li key={entry.id} className="group flex items-start gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="break-words whitespace-pre-line text-fg">{entry.content}</span>
                    <span className="text-fg-subtle">
                      {[entry.model_name, formatRelativeTime(entry.created_at)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  <IconButton
                    label="Delete memory"
                    title="Delete memory"
                    size="sm"
                    onClick={() => setDeleteTarget(entry)}
                    className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                  >
                    <Trash2 />
                  </IconButton>
                </li>
              ))}
            </ul>
          ) : null}
          {status === 'ready' && hasMore ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleLoadMore()}
              disabled={loadingMore}
              className="self-start"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          ) : null}
        </div>
      </DetailsSection>
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete memory?"
        description="The assistant will no longer see this note in future chats."
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
