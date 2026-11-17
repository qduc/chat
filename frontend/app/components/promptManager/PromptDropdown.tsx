import React from 'react';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Check, ChevronDown } from 'lucide-react';
import { BuiltInPrompt, CustomPrompt } from '../../../hooks/useSystemPrompts';
import { Menu, MenuContent, MenuTrigger, floatingItemClasses } from '../../../components/ui/Menu';
import { cn } from '../../../lib/cn';

interface PromptDropdownProps {
  builtIns: BuiltInPrompt[];
  customPrompts: CustomPrompt[];
  selectedPromptId: string | null;
  hasUnsavedChanges: (promptId: string) => boolean;
  onSelectPrompt: (promptId: string) => void;
  onClearSelection: () => void;
}

/** Radio value used for the "No system prompt" option. */
const NONE = '';

export default function PromptDropdown({
  builtIns,
  customPrompts,
  selectedPromptId,
  hasUnsavedChanges,
  onSelectPrompt,
  onClearSelection,
}: PromptDropdownProps) {
  const sortedBuiltIns = [...builtIns].sort((a, b) => a.order - b.order);
  const sortedCustom = [...customPrompts].sort((a, b) => {
    if (!a.last_used_at && !b.last_used_at) {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (!a.last_used_at) return 1;
    if (!b.last_used_at) return -1;
    return new Date(b.last_used_at).getTime() - new Date(a.last_used_at).getTime();
  });

  const items = [
    { id: NONE, name: 'No system prompt', isBuiltIn: false },
    ...sortedBuiltIns.map((p) => ({ id: p.id, name: p.name, isBuiltIn: true })),
    ...sortedCustom.map((p) => ({ id: p.id, name: p.name, isBuiltIn: false })),
  ];

  const selectedPrompt = selectedPromptId
    ? [...sortedBuiltIns, ...sortedCustom].find((p) => p.id === selectedPromptId)
    : null;

  const displayText = selectedPrompt
    ? `${selectedPrompt.name}${hasUnsavedChanges(selectedPrompt.id) ? ' *' : ''}`
    : 'No system prompt';

  const handleSelect = (promptId: string) => {
    if (promptId === NONE) {
      onClearSelection();
    } else {
      onSelectPrompt(promptId);
    }
  };

  return (
    <Menu>
      <MenuTrigger
        aria-label="Select system prompt"
        className={cn(
          'flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-control border border-line-strong bg-surface px-3',
          'text-left text-sm text-fg transition-colors hover:bg-muted focus-ring touch-target'
        )}
      >
        <span className="min-w-0 flex-1 truncate">{displayText}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
      </MenuTrigger>
      <MenuContent align="start" className="max-h-64 w-(--anchor-width) min-w-0 overflow-y-auto">
        <BaseMenu.RadioGroup value={selectedPromptId ?? NONE} aria-label="System prompt options">
          {items.map((item) => (
            <BaseMenu.RadioItem
              key={item.id || 'none'}
              value={item.id}
              closeOnClick
              onClick={() => handleSelect(item.id)}
              className={floatingItemClasses}
            >
              <span className="min-w-0 flex-1 truncate">
                {item.name}
                {item.id && hasUnsavedChanges(item.id) ? (
                  <span className="ml-1 text-accent">*</span>
                ) : null}
              </span>
              {item.isBuiltIn ? (
                <span className="shrink-0 rounded-full bg-muted px-2 text-xs text-fg-muted">
                  Built-in
                </span>
              ) : null}
              <span aria-hidden="true" className="flex size-4 shrink-0">
                <BaseMenu.RadioItemIndicator>
                  <Check />
                </BaseMenu.RadioItemIndicator>
              </span>
            </BaseMenu.RadioItem>
          ))}
        </BaseMenu.RadioGroup>

        {sortedBuiltIns.length === 0 && sortedCustom.length === 0 && (
          <p className="px-3 py-2 text-sm text-fg-subtle">No prompts available</p>
        )}
      </MenuContent>
    </Menu>
  );
}
