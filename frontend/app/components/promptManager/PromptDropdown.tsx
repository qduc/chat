import React, { useState, useRef, useEffect } from 'react';
import { BuiltInPrompt, CustomPrompt } from '../../../hooks/useSystemPrompts';

interface PromptDropdownProps {
  builtIns: BuiltInPrompt[];
  customPrompts: CustomPrompt[];
  selectedPromptId: string | null;
  hasUnsavedChanges: (promptId: string) => boolean;
  onSelectPrompt: (promptId: string) => void;
  onClearSelection: () => void;
}

// Chevron icon for dropdown indicator
const ChevronDownIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m19 9-7 7-7-7" />
  </svg>
);

export default function PromptDropdown({
  builtIns,
  customPrompts,
  selectedPromptId,
  hasUnsavedChanges,
  onSelectPrompt,
  onClearSelection,
}: PromptDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Sort prompts
  const sortedBuiltIns = [...builtIns].sort((a, b) => a.order - b.order);
  const sortedCustom = [...customPrompts].sort((a, b) => {
    if (!a.last_used_at && !b.last_used_at) {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (!a.last_used_at) return 1;
    if (!b.last_used_at) return -1;
    return new Date(b.last_used_at).getTime() - new Date(a.last_used_at).getTime();
  });

  // Build dropdown items array for keyboard navigation
  const dropdownItems = [
    { type: 'option', id: null, name: 'No system prompt' },
    ...sortedBuiltIns.map((prompt) => ({
      type: 'option',
      id: prompt.id,
      name: prompt.name,
      isBuiltIn: true,
    })),
    ...sortedCustom.map((prompt) => ({
      type: 'option',
      id: prompt.id,
      name: prompt.name,
      isBuiltIn: false,
    })),
  ] as Array<{
    type: 'option' | 'header';
    id?: string | null;
    name?: string;
    label?: string;
    isBuiltIn?: boolean;
  }>;

  // Get selectable items only (not headers)
  const selectableItems = dropdownItems.filter((item) => item.type === 'option');

  // Get selected prompt for display
  const selectedPrompt = selectedPromptId
    ? [...sortedBuiltIns, ...sortedCustom].find((p) => p.id === selectedPromptId)
    : null;

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setFocusedIndex(-1);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!isOpen) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        setIsOpen(true);
        setFocusedIndex(0);
      }
      return;
    }

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        setIsOpen(false);
        setFocusedIndex(-1);
        buttonRef.current?.focus();
        break;

      case 'ArrowDown':
        event.preventDefault();
        setFocusedIndex((prev) => (prev < selectableItems.length - 1 ? prev + 1 : 0));
        break;

      case 'ArrowUp':
        event.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : selectableItems.length - 1));
        break;

      case 'Enter':
      case ' ':
        event.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < selectableItems.length) {
          const selectedItem = selectableItems[focusedIndex];
          handleSelect(selectedItem.id || null);
        }
        break;

      case 'Tab':
        setIsOpen(false);
        setFocusedIndex(-1);
        break;
    }
  };

  const handleSelect = (promptId: string | null) => {
    if (promptId === null) {
      onClearSelection();
    } else {
      onSelectPrompt(promptId);
    }
    setIsOpen(false);
    setFocusedIndex(-1);
    buttonRef.current?.focus();
  };

  const handleToggle = () => {
    setIsOpen(!isOpen);
    if (!isOpen) {
      setFocusedIndex(0);
    } else {
      setFocusedIndex(-1);
    }
  };

  const getDisplayText = () => {
    if (!selectedPrompt) {
      return 'No system prompt';
    }

    const hasChanges = hasUnsavedChanges(selectedPrompt.id);
    return `${selectedPrompt.name}${hasChanges ? ' *' : ''}`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Dropdown button */}
      <button
        ref={buttonRef}
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:border-zinc-400"
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Select system prompt"
      >
        <span className="truncate text-left flex-1 text-zinc-800 dark:text-zinc-200 font-medium">
          {getDisplayText()}
        </span>
        <ChevronDownIcon
          className={`w-4 h-4 text-zinc-500 ml-2 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className="absolute z-50 w-full mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg max-h-64 overflow-y-auto"
          role="listbox"
          aria-label="System prompt options"
        >
          {dropdownItems.map((item, index) => {
            const selectableIndex = selectableItems.findIndex((selectable) => selectable === item);
            const isFocused = focusedIndex === selectableIndex;
            const isSelected = selectedPromptId === item.id;
            const hasChanges = item.id && hasUnsavedChanges(item.id);

            return (
              <div
                key={item.id || 'none'}
                className={`
                  px-3 py-2 text-sm cursor-pointer flex items-center justify-between transition-colors
                  ${isFocused ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}
                  ${isSelected ? 'bg-zinc-50 dark:bg-zinc-800/50 text-zinc-900 dark:text-zinc-100 font-medium' : 'text-zinc-700 dark:text-zinc-300'}
                `}
                onClick={() => handleSelect(item.id || null)}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setFocusedIndex(selectableIndex)}
              >
                <div className="flex items-center min-w-0 flex-1">
                  <span className="truncate">
                    {item.name}
                    {hasChanges && <span className="text-orange-500 ml-1">*</span>}
                  </span>
                  {item.isBuiltIn && (
                    <span className="ml-2 px-1.5 py-0.5 text-xs bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded flex-shrink-0">
                      Built-in
                    </span>
                  )}
                </div>
                {isSelected && (
                  <svg
                    className="w-4 h-4 text-zinc-600 dark:text-zinc-400 ml-2 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>
            );
          })}

          {/* Empty state */}
          {sortedBuiltIns.length === 0 && sortedCustom.length === 0 && (
            <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">
              No prompts available
            </div>
          )}
        </div>
      )}
    </div>
  );
}
