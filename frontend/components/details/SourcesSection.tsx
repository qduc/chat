import React from 'react';
import { DetailsSection } from './DetailsSection';
import type { ConversationSource } from '../../lib/conversationSources';

interface SourcesSectionProps {
  sources: ConversationSource[];
  open: boolean;
  onToggle: () => void;
}

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
  return (
    <DetailsSection title="Sources" count={sources.length} open={open} onToggle={onToggle}>
      <ul className="flex flex-col gap-1 pb-2">
        {sources.map((source) => (
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
    </DetailsSection>
  );
}
