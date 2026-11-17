import React, { useState } from 'react';
import { DetailsSection } from './DetailsSection';
import { Button } from '../ui/Button';
import type { ConversationSource } from '../../lib/conversationSources';

interface SourcesSectionProps {
  sources: ConversationSource[];
  open: boolean;
  onToggle: () => void;
}

/** How many sources show before "Show all"; keeps a search-heavy chat from filling the panel. */
export const SOURCES_PREVIEW_COUNT = 5;

/** Letter tile instead of a favicon, so no request leaves for third-party hosts. */
function LetterTile({ hostname }: { hostname: string }) {
  const letter = (hostname.match(/[a-z0-9]/i)?.[0] ?? '?').toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center rounded-control bg-emphasis text-xs font-medium text-fg-muted"
    >
      {letter}
    </span>
  );
}

/** Pages found or fetched by the web tools in this conversation. */
export function SourcesSection({ sources, open, onToggle }: SourcesSectionProps) {
  const [showAll, setShowAll] = useState(false);
  const hidden = sources.length - SOURCES_PREVIEW_COUNT;
  const visible = showAll || hidden <= 0 ? sources : sources.slice(0, SOURCES_PREVIEW_COUNT);

  return (
    <DetailsSection title="Sources" count={sources.length} open={open} onToggle={onToggle}>
      <ul className="flex flex-col gap-1 pb-2">
        {visible.map((source) => (
          <li key={source.url}>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-3 rounded-control px-1 py-2 text-fg transition-colors hover:bg-muted focus-ring touch-target"
            >
              <LetterTile hostname={source.hostname || source.url} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{source.title || source.url}</span>
                <span className="truncate text-xs text-fg-subtle">{source.hostname}</span>
              </span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 text-fg-muted"
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? 'Show fewer' : `Show all ${sources.length}`}
        </Button>
      ) : null}
    </DetailsSection>
  );
}
