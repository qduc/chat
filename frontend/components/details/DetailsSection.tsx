import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';

interface DetailsSectionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  /** Shown next to the title, e.g. the number of sources. */
  count?: number | string;
  /** One-line summary shown on the right while the section is collapsed. */
  summary?: string;
  children: React.ReactNode;
  className?: string;
}

/** A collapsible section of the chat details panel. */
export function DetailsSection({
  title,
  open,
  onToggle,
  count,
  summary,
  children,
  className,
}: DetailsSectionProps) {
  const bodyId = useId();
  return (
    <section aria-label={title} className={cn('border-b border-line px-3 py-2', className)}>
      <h2 className="text-sm">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={onToggle}
          className="flex h-9 w-full items-center gap-2 rounded-control px-1 text-left text-fg transition-colors hover:bg-muted focus-ring touch-target"
        >
          <span className="min-w-0 flex-1 truncate font-medium">
            {title}
            {count !== undefined && (
              <span className="ml-2 font-normal text-fg-subtle">{count}</span>
            )}
          </span>
          {!open && summary ? (
            <span className="min-w-0 max-w-1/2 shrink truncate text-xs text-fg-subtle">
              {summary}
            </span>
          ) : null}
          <ChevronDown
            aria-hidden="true"
            className={cn('size-4 shrink-0 text-fg-muted', !open && '-rotate-90')}
          />
        </button>
      </h2>
      {open ? <div id={bodyId}>{children}</div> : null}
    </section>
  );
}
