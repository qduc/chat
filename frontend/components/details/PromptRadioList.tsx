import React, { useId } from 'react';
import { cn } from '../../lib/cn';

export interface PromptRadioItem {
  /** null is the "None" option. */
  id: string | null;
  name: string;
  builtIn?: boolean;
  /** Has unsaved inline edits. */
  edited?: boolean;
}

interface PromptRadioListProps {
  items: PromptRadioItem[];
  /** The checked option; undefined when no option is checked. */
  checkedId: string | null | undefined;
  onSelect: (id: string | null) => void;
  /** Extra content under the checked option (preview, actions, editor). */
  renderExpanded?: (item: PromptRadioItem) => React.ReactNode;
  footer?: React.ReactNode;
}

const NONE_VALUE = '__none__';

/**
 * Native radio inputs sharing one name inside a labelled fieldset: arrow keys
 * move and select, Tab enters at the checked option, Space selects.
 */
export function PromptRadioList({
  items,
  checkedId,
  onSelect,
  renderExpanded,
  footer,
}: PromptRadioListProps) {
  const name = useId();

  return (
    <div className="flex flex-col gap-1 pt-1 pb-2">
      {/* A fieldset (not role="radiogroup") so the selected prompt's actions can sit
          inside the group without breaking ARIA ownership rules. */}
      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className="sr-only">System prompt</legend>
        {items.map((item) => {
          const value = item.id ?? NONE_VALUE;
          const checked = checkedId !== undefined && (checkedId ?? NONE_VALUE) === value;
          const expanded = checked && item.id !== null ? renderExpanded?.(item) : null;
          return (
            <div
              key={value}
              className={cn(
                'rounded-control border',
                expanded ? 'border-line bg-surface' : 'border-transparent'
              )}
            >
              <label className="flex cursor-pointer items-center gap-3 rounded-control p-2 transition-colors hover:bg-muted touch-target">
                <span className="relative flex size-4 shrink-0 items-center justify-center">
                  <input
                    type="radio"
                    name={name}
                    value={value}
                    checked={checked}
                    onChange={() => onSelect(item.id)}
                    className="peer size-4 cursor-pointer appearance-none rounded-full border border-line-strong transition-colors checked:border-accent focus-ring"
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute hidden size-2 rounded-full bg-accent peer-checked:block"
                  />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{item.name}</span>
                {item.edited ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-fg-muted">
                    <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
                    Edited
                  </span>
                ) : null}
                {item.builtIn ? (
                  <span className="shrink-0 rounded-full bg-muted px-2 text-xs text-fg-muted">
                    Built-in
                  </span>
                ) : null}
              </label>
              {expanded ? <div className="px-2 pb-2">{expanded}</div> : null}
            </div>
          );
        })}
      </fieldset>
      {footer}
    </div>
  );
}
