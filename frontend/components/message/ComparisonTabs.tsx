/**
 * ComparisonTabs - Model selection tabs for comparison mode
 * Shows tabs for selecting which models to display
 */

import React from 'react';
import { MAX_COMPARISON_COLUMNS } from './types';

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

  return (
    <div className="flex items-center gap-2 mb-2 overflow-x-auto pb-1 no-scrollbar">
      {/* All button - hidden on mobile (single model only) */}
      {!isMobile && (
        <button
          onClick={() => onSelectAll(allModels)}
          className={`px-2.5 py-1 text-xs rounded-full border transition-colors whitespace-nowrap ${
            activeModels.length === Math.min(allModels.length, MAX_COMPARISON_COLUMNS)
              ? 'bg-zinc-800 text-white border-zinc-800 dark:bg-zinc-200 dark:text-zinc-900 dark:border-zinc-200'
              : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800'
          }`}
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
        const displayName = getModelDisplayName(modelId);

        return (
          <button
            key={modelId}
            onClick={(e) => onToggleModel(modelId, e)}
            disabled={isDisabled}
            title={isDisabled ? `Maximum ${MAX_COMPARISON_COLUMNS} models` : undefined}
            className={`px-3 py-1 text-xs rounded-full border transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              isSelected
                ? 'bg-zinc-800 text-white border-zinc-800 dark:bg-zinc-200 dark:text-zinc-900 dark:border-zinc-200'
                : isDisabled
                  ? 'bg-zinc-50 dark:bg-zinc-900/50 text-zinc-400 dark:text-zinc-600 border-zinc-200 dark:border-zinc-800 cursor-not-allowed opacity-50'
                  : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            }`}
          >
            {/* Checkbox indicator - only on desktop */}
            {!isMobile && (
              <span
                className={`w-3 h-3 rounded border flex items-center justify-center text-[10px] ${
                  isSelected
                    ? 'bg-white dark:bg-zinc-900 border-white dark:border-zinc-900 text-zinc-800 dark:text-zinc-200'
                    : 'border-zinc-400 dark:border-zinc-500'
                }`}
              >
                {isSelected && '✓'}
              </span>
            )}
            {displayName}
          </button>
        );
      })}
      {/* Hint text - hidden on mobile */}
      <span className="hidden md:inline ml-auto text-[10px] text-zinc-400 dark:text-zinc-600 whitespace-nowrap">
        {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+click for single model
      </span>
    </div>
  );
}
