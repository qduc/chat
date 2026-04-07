/**
 * RevisionNavigation - Arrow navigation for browsing message revisions.
 * Shows "← 2 / 3 →" for every revision, including the latest one.
 */

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface RevisionNavigationProps {
  /** 1-based index of the currently displayed version (total = revisionCount + 1) */
  current: number;
  /** Total number of versions = revisionCount + 1 */
  total: number;
  onPrev: () => void;
  onNext: () => void;
  loading?: boolean;
}

export function RevisionNavigation({
  current,
  total,
  onPrev,
  onNext,
  loading,
}: RevisionNavigationProps) {
  return (
    <div className="flex items-center gap-1 select-none">
      <button
        onClick={onPrev}
        disabled={current <= 1 || loading}
        className="p-0.5 rounded text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Previous version"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>

      <span className="text-xs text-zinc-500 dark:text-zinc-400 min-w-[3.5rem] text-center tabular-nums">
        {loading ? (
          <span className="text-zinc-400 dark:text-zinc-500">…</span>
        ) : (
          <>
            <span className="font-medium text-zinc-600 dark:text-zinc-300">{current}</span>
            <span className="mx-0.5">/</span>
            <span>{total}</span>
          </>
        )}
      </span>

      <button
        onClick={onNext}
        disabled={current >= total || loading}
        className="p-0.5 rounded text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Next version"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
