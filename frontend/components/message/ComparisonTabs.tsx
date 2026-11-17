/**
 * ComparisonTabs - Model selection tabs for comparison mode
 * Shows tabs for selecting which models to display
 */

import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';
import { MAX_COMPARISON_COLUMNS } from './types';

const chipClasses =
  'inline-flex h-7 shrink-0 items-center gap-2 rounded-full border px-3 text-xs whitespace-nowrap transition-colors focus-ring touch-target ' +
  'disabled:cursor-not-allowed disabled:opacity-50';
const chipStateClasses = (selected: boolean) =>
  selected
    ? 'border-line-strong bg-emphasis text-fg'
    : 'border-line bg-surface text-fg-muted hover:bg-muted hover:text-fg';

interface ComparisonTabsProps {
  allModels: string[];
  activeModels: string[];
  primaryModelLabel: string | null;
  isMobile: boolean;
  onToggleModel: (modelId: string, event?: React.MouseEvent) => void;
  onSelectAll: (models: string[]) => void;
}

export function ComparisonTabs({
  allModels,
  activeModels,
  primaryModelLabel,
  isMobile,
  onToggleModel,
  onSelectAll,
}: ComparisonTabsProps) {
  const getModelDisplayName = (modelId: string) => {
    if (modelId === 'primary') {
      return primaryModelLabel
        ? primaryModelLabel.includes('::')
          ? primaryModelLabel.split('::')[1]
          : primaryModelLabel
        : 'Primary';
    }
    return modelId.includes('::') ? modelId.split('::')[1] : modelId;
  };

  const allSelected = activeModels.length === Math.min(allModels.length, MAX_COMPARISON_COLUMNS);

  return (
    <div className="mb-2 flex items-center gap-2 overflow-x-auto pb-1">
      {/* All button - hidden on mobile (single model only) */}
      {!isMobile && (
        <button
          type="button"
          aria-pressed={allSelected}
          onClick={() => onSelectAll(allModels)}
          className={cn(chipClasses, chipStateClasses(allSelected))}
        >
          All
        </button>
      )}
      {allModels.map((modelId) => {
        const isSelected = activeModels.includes(modelId);
        // On mobile: no disabled state (radio behavior)
        // On desktop: disable if max columns reached
        const isDisabled =
          !isMobile && !isSelected && activeModels.length >= MAX_COMPARISON_COLUMNS;

        return (
          <button
            type="button"
            key={modelId}
            aria-pressed={isSelected}
            onClick={(e) => onToggleModel(modelId, e)}
            disabled={isDisabled}
            title={isDisabled ? `Maximum ${MAX_COMPARISON_COLUMNS} models` : undefined}
            className={cn(chipClasses, chipStateClasses(isSelected))}
          >
            {/* Checkbox indicator - only on desktop */}
            {!isMobile && (
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-4 items-center justify-center rounded-full border',
                  isSelected ? 'border-accent bg-accent text-on-accent' : 'border-line-strong'
                )}
              >
                {isSelected && <Check className="size-3" />}
              </span>
            )}
            {getModelDisplayName(modelId)}
          </button>
        );
      })}
      {/* Hint text - hidden on mobile */}
      <span className="ml-auto hidden text-xs whitespace-nowrap text-fg-subtle md:inline">
        {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+click for single model
      </span>
    </div>
  );
}
