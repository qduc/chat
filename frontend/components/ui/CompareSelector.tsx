import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronDown, Check, GitFork } from 'lucide-react';
import { type Group as TabGroup } from './TabbedSelect';
import ModelSelectBase, { type Section, type SelectOption, type Tab } from './ModelSelectBase';

interface ModelOption extends SelectOption {}

interface CompareSelectorProps {
  primaryModel: string;
  selectedModels: string[];
  onChange: (models: string[]) => void;
  groups: TabGroup[] | null;
  fallbackOptions: ModelOption[];
  className?: string;
  ariaLabel?: string;
}

// Memoized Item component
const CompareModelItem = React.memo(
  ({
    model,
    isSelected,
    isPrimary,
    onToggle,
    isHighlighted,
    id,
  }: {
    model: ModelOption;
    isSelected: boolean;
    isPrimary: boolean;
    onToggle: (value: string) => void;
    isHighlighted: boolean;
    id: string;
  }) => (
    <div
      id={id}
      role="option"
      aria-selected={isSelected}
      onClick={(e) => {
        e.stopPropagation();
        if (!isPrimary) onToggle(model.value);
      }}
      className={`w-full flex items-center transition-colors cursor-pointer ${
        isHighlighted
          ? 'bg-zinc-100 dark:bg-zinc-800'
          : isSelected || isPrimary
            ? 'bg-zinc-50 dark:bg-zinc-800/50'
            : ''
      } hover:bg-zinc-100 dark:hover:bg-zinc-800`}
    >
      <div className="flex items-center justify-center w-10 h-9">
        {isPrimary ? (
          <div
            className="w-2 h-2 rounded-full bg-zinc-400 dark:bg-zinc-500"
            title="Primary Model"
          />
        ) : (
          <div
            className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
              isSelected
                ? 'bg-zinc-900 border-zinc-900 dark:bg-zinc-100 dark:border-zinc-100'
                : 'border-zinc-300 dark:border-zinc-600'
            }`}
          >
            {isSelected && <Check className="w-3 h-3 text-white dark:text-zinc-900" />}
          </div>
        )}
      </div>
      <div
        className={`flex-1 min-w-0 px-3 py-2 text-left ${isPrimary ? 'opacity-60 cursor-default' : ''}`}
      >
        <div
          className={`text-sm truncate leading-tight ${isSelected || isPrimary ? 'font-medium text-zinc-900 dark:text-zinc-100' : 'text-zinc-700 dark:text-zinc-300'}`}
        >
          {model.label} {isPrimary && '(Primary)'}
        </div>
        {model.provider && (
          <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate leading-tight">
            {model.provider}
          </div>
        )}
      </div>
    </div>
  )
);

CompareModelItem.displayName = 'CompareModelItem';

export default function CompareSelector({
  primaryModel,
  selectedModels,
  onChange,
  groups,
  fallbackOptions,
  className = '',
  ariaLabel = 'Select models to compare',
}: CompareSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTab, setSelectedTab] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState(50);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);

  // Get all available models with provider info
  const allModels = useMemo(() => {
    let result;
    if (groups && groups.length > 0) {
      result = groups.flatMap((group) =>
        group.options.map((option) => ({
          ...option,
          provider: group.label,
          providerId: group.id,
        }))
      );
    } else {
      result = fallbackOptions.map((option) => ({
        ...option,
        provider: option.provider || 'Default',
        providerId: 'default',
      }));
    }
    return result;
  }, [groups, fallbackOptions]);

  // Get available provider tabs
  const providerTabs = useMemo<Tab[]>(() => {
    const tabs: Tab[] = [{ id: 'all', label: 'All', count: allModels.length }];
    if (groups && groups.length > 1) {
      groups.forEach((group) => {
        tabs.push({
          id: group.id,
          label: group.label,
          count: group.options.length,
        });
      });
    }
    return tabs;
  }, [groups, allModels.length]);

  // Filter models based on search query and selected tab
  const filteredModels = useMemo(() => {
    let models = allModels;

    if (selectedTab !== 'all') {
      models = models.filter((model) => model.providerId === selectedTab);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      models = models.filter(
        (model) =>
          model.label.toLowerCase().includes(query) ||
          model.value.toLowerCase().includes(query) ||
          (model.provider && model.provider.toLowerCase().includes(query))
      );
    }

    return models;
  }, [allModels, searchQuery, selectedTab]);

  const handleToggle = useCallback(
    (modelValue: string) => {
      if (modelValue === primaryModel) return;

      const newSelection = selectedModels.includes(modelValue)
        ? selectedModels.filter((m) => m !== modelValue)
        : [...selectedModels, modelValue];

      onChange(newSelection);
    },
    [primaryModel, selectedModels, onChange]
  );

  useEffect(() => {
    if (!isOpen) {
      setVisibleCount(50);
    }
  }, [isOpen]);

  const activeCount = selectedModels.length;

  const sections = useMemo<Section<ModelOption>[]>(
    () => [
      {
        id: 'models',
        items: filteredModels.slice(0, visibleCount),
      },
    ],
    [filteredModels, visibleCount]
  );

  return (
    <ModelSelectBase<ModelOption>
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      onClose={() => {
        setSearchQuery('');
        setSelectedTab('all');
      }}
      ariaLabel={ariaLabel}
      className={className}
      dropdownAlign="right"
      listClassName="max-h-[60vh]"
      tabs={providerTabs}
      activeTab={selectedTab}
      onTabChange={setSelectedTab}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      sections={sections}
      renderItem={(model, index, isHighlighted) => (
        <CompareModelItem
          key={`compare-${model.providerId}-${model.value}`}
          id={`compare-item-${index}`}
          model={model}
          isSelected={selectedModels.includes(model.value)}
          isPrimary={model.value === primaryModel}
          onToggle={handleToggle}
          isHighlighted={isHighlighted}
        />
      )}
      emptyState={
        filteredModels.length === 0 ? (
          <div className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">
            No models found.
          </div>
        ) : null
      }
      footer={
        <div className="p-2 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex justify-between items-center">
          <span className="text-xs text-zinc-500">{selectedModels.length} selected</span>
          {selectedModels.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
            >
              Clear all
            </button>
          )}
        </div>
      }
      highlightedIndex={highlightedIndex}
      setHighlightedIndex={setHighlightedIndex}
      onEnter={(model) => handleToggle(model.value)}
      enableKeyboardNavigation
      getItemId={(index) => `compare-item-${index}`}
      trigger={
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors border ${
            activeCount > 0 || isOpen
              ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100'
              : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
          }`}
          aria-label={ariaLabel}
          title="Compare with other models"
        >
          <GitFork className="w-4 h-4" />
          {activeCount > 0 && <span className="text-xs font-medium">{activeCount}</span>}
          <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      }
    />
  );
}
