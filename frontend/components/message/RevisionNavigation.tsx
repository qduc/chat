/**
 * RevisionNavigation - Arrow navigation for browsing message revisions.
 * Shows "← 2 / 3 →" for every revision, including the latest one.
 */

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '../ui/Button';

interface RevisionNavigationProps {
  /** 1-based index of the currently displayed version (total = revisionCount + 1) */
  current: number;
  /** Total number of versions = revisionCount + 1 */
  total: number;
  onPrev: () => void;
  onNext: () => void;
  loading?: boolean;
  disabled?: boolean;
}

export function RevisionNavigation({
  current,
  total,
  onPrev,
  onNext,
  loading,
  disabled,
}: RevisionNavigationProps) {
  return (
    <div className="flex items-center gap-1 select-none">
      <IconButton
        label="Previous version"
        onClick={onPrev}
        disabled={current <= 1 || loading || disabled}
        className="size-7"
      >
        <ChevronLeft />
      </IconButton>

      <span className="min-w-14 text-center text-xs text-fg-subtle tabular-nums">
        {loading ? (
          '…'
        ) : (
          <>
            <span className="font-medium text-fg-muted">{current}</span>
            <span className="mx-1">/</span>
            {total}
          </>
        )}
      </span>

      <IconButton
        label="Next version"
        onClick={onNext}
        disabled={current >= total || loading || disabled}
        className="size-7"
      >
        <ChevronRight />
      </IconButton>
    </div>
  );
}
