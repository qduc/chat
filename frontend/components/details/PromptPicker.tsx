import React, { useMemo, useState } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { Check, ChevronDown, Plus, Search } from 'lucide-react';
import { cn } from '../../lib/cn';
import { floatingPanelClasses } from '../ui/Menu';

export interface PromptOption {
  /** null is the "None" option. */
  id: string | null;
  name: string;
  builtIn?: boolean;
  /** Has unsaved inline edits. */
  edited?: boolean;
}

interface PromptGroup {
  value: string;
  label: string;
  items: PromptOption[];
}

interface PromptPickerProps {
  options: PromptOption[];
  /** The selected option's id; undefined when a custom (unsaved) prompt is in effect. */
  selectedId: string | null | undefined;
  /** Shown on the trigger when nothing in the list is selected (a custom draft). */
  fallbackLabel?: string;
  onSelect: (id: string | null) => void;
  onNewPrompt: () => void;
}

/** Search only pays off once the list is longer than a glance. */
const SEARCH_THRESHOLD = 7;

function EditedDot() {
  return <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent" />;
}

/**
 * One-row prompt picker: a trigger showing the active prompt, opening a
 * searchable list grouped into None / Built-in / Your prompts. Stays compact
 * however many prompts are saved.
 */
export function PromptPicker({
  options,
  selectedId,
  fallbackLabel = 'Custom prompt',
  onSelect,
  onNewPrompt,
}: PromptPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected =
    selectedId === undefined ? null : (options.find((o) => o.id === selectedId) ?? null);
  const showSearch = options.length > SEARCH_THRESHOLD;

  const groups = useMemo<PromptGroup[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (o: PromptOption) => !q || o.name.toLowerCase().includes(q);
    const none = options.filter((o) => o.id === null && match(o));
    const builtIn = options.filter((o) => o.id !== null && o.builtIn && match(o));
    const custom = options.filter((o) => o.id !== null && !o.builtIn && match(o));
    return [
      { value: 'none', label: '', items: none },
      { value: 'builtin', label: 'Built-in', items: builtIn },
      { value: 'custom', label: 'Your prompts', items: custom },
    ].filter((g) => g.items.length > 0);
  }, [options, query]);

  return (
    <Combobox.Root<PromptOption>
      items={groups}
      filter={null}
      value={selected}
      onValueChange={(next) => {
        if (next) onSelect(next.id);
      }}
      isItemEqualToValue={(a, b) => a.id === b.id}
      itemToStringLabel={(item) => item.name}
      inputValue={query}
      onInputValueChange={setQuery}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
      modal
    >
      <Combobox.Trigger
        aria-label={`System prompt: ${selected?.name ?? fallbackLabel}`}
        className={cn(
          'flex h-8 w-full min-w-0 items-center gap-2 rounded-control border border-line bg-surface px-2 text-sm text-fg',
          'transition-colors hover:bg-muted data-popup-open:bg-muted focus-ring touch-target'
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">{selected?.name ?? fallbackLabel}</span>
        {selected?.edited ? <EditedDot /> : null}
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
      </Combobox.Trigger>

      <Combobox.Portal>
        <Combobox.Positioner
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 outline-none"
        >
          <Combobox.Popup
            aria-label="System prompts"
            className={cn(
              floatingPanelClasses,
              'flex max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) min-w-64 flex-col overflow-hidden p-0'
            )}
          >
            {showSearch ? (
              <div className="relative shrink-0 border-b border-line p-2">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-fg-subtle"
                />
                <Combobox.Input
                  aria-label="Search prompts"
                  placeholder="Search prompts…"
                  className="h-8 w-full rounded-control border border-line-strong bg-surface pr-2 pl-8 text-sm text-fg placeholder:text-fg-subtle focus-ring"
                />
              </div>
            ) : null}

            <Combobox.Empty className="px-3 py-4 text-center text-sm text-fg-muted empty:hidden">
              No prompts match “{query}”
            </Combobox.Empty>

            <Combobox.List className="max-h-72 min-h-0 flex-1 overflow-y-auto p-1 empty:hidden">
              {(group: PromptGroup) => (
                <Combobox.Group key={group.value} items={group.items} className="pb-1 last:pb-0">
                  {group.label ? (
                    <Combobox.GroupLabel className="px-2 pt-2 pb-1 text-xs text-fg-subtle">
                      {group.label}
                    </Combobox.GroupLabel>
                  ) : null}
                  <Combobox.Collection>
                    {(option: PromptOption) => (
                      <Combobox.Item
                        key={option.id ?? '__none__'}
                        value={option}
                        className="flex h-8 cursor-default items-center gap-2 rounded-control px-2 text-sm text-fg outline-none select-none data-highlighted:bg-muted"
                      >
                        <span className="min-w-0 flex-1 truncate">{option.name}</span>
                        {option.edited ? (
                          <>
                            <EditedDot />
                            <span className="sr-only">(edited)</span>
                          </>
                        ) : null}
                        <Combobox.ItemIndicator className="flex shrink-0">
                          <Check aria-hidden="true" className="size-4 text-accent" />
                        </Combobox.ItemIndicator>
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>

            <div className="shrink-0 border-t border-line p-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onNewPrompt();
                }}
                className="flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-sm text-fg-muted transition-colors hover:bg-muted hover:text-fg focus-ring-inset touch-target"
              >
                <Plus aria-hidden="true" className="size-4" />
                New prompt
              </button>
            </div>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
