import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Star, StarOff, ChevronDown, Check, Plus } from 'lucide-react';
import { type Group as TabGroup } from './TabbedSelect';
import ModelSelectBase, { type Section, type SelectOption, type Tab } from './ModelSelectBase';
import Tooltip from './Tooltip';
import { useAuth } from '../../contexts/AuthContext';

type ModelOption = SelectOption;

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  groups: TabGroup[] | null;
  fallbackOptions: ModelOption[];
  className?: string;
  ariaLabel?: string;
  onAfterChange?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  favoritesStorageKey?: string;
  recentStorageKey?: string;
  // Comparison props
  selectedComparisonModels?: string[];
  onComparisonModelsChange?: (models: string[]) => void;
  comparisonDisabled?: boolean;
  comparisonDisabledReason?: string;
}

const FAVORITES_KEY = 'chatforge-favorite-models';
const RECENT_KEY = 'chatforge-recent-models';
const EMPTY_ARRAY: any[] = [];
const EMPTY_STRING_ARRAY: string[] = [];

// Memoized ModelItem component to prevent unnecessary re-renders
const ModelItem = React.memo(
  ({
    model,
    isSelected,
    isFavorite,
    onToggleFavorite,
    onSelect,
    isHighlighted,
    id,
    isInComparison,
    onToggleComparison,
    comparisonDisabled,
  }: {
    model: ModelOption;
    isSelected: boolean;
    isFavorite: boolean;
    onToggleFavorite: (value: string) => void;
    onSelect: (value: string) => void;
    isHighlighted: boolean;
    id: string;
    isInComparison?: boolean;
    onToggleComparison?: (value: string) => void;
    comparisonDisabled?: boolean;
  }) => (
    <div
      id={id}
      role="option"
      aria-selected={isHighlighted}
      className={`w-full flex items-center transition-colors ${
        isHighlighted
          ? 'bg-zinc-100 dark:bg-zinc-800'
          : isSelected
            ? 'bg-zinc-50 dark:bg-zinc-800/50'
            : ''
      } hover:bg-zinc-100 dark:hover:bg-zinc-800`}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(model.value);
        }}
        className="flex items-center justify-center w-10 h-9 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        {isFavorite ? (
          <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
        ) : (
          <StarOff className="w-3.5 h-3.5 text-zinc-400" />
        )}
      </button>
      <button
        onClick={() => onSelect(model.value)}
        title={model.label}
        aria-label={model.label}
        className={`flex-1 min-w-0 px-3 py-2 text-left transition-colors ${
          isSelected
            ? 'text-zinc-900 dark:text-zinc-100 font-medium'
            : 'text-zinc-700 dark:text-zinc-300'
        }`}
      >
        <div className="text-sm font-medium truncate leading-tight">{model.label}</div>
        {model.provider && (
          <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate leading-tight">
            {model.provider}
          </div>
        )}
      </button>

      {onToggleComparison && (
        <div className="flex items-center justify-center w-10 h-9">
          {isSelected ? (
            <div
              className="w-2 h-2 rounded-full bg-zinc-400 dark:bg-zinc-500"
              title="Primary Model"
            />
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!comparisonDisabled) onToggleComparison(model.value);
              }}
              disabled={comparisonDisabled}
              className={`${
                isInComparison ? 'w-4 h-4' : 'w-6 h-6'
              } rounded flex items-center justify-center transition-colors ${
                isInComparison
                  ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                  : 'text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              } ${comparisonDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              title={
                comparisonDisabled
                  ? 'Comparison is locked'
                  : isInComparison
                    ? 'Remove from comparison'
                    : 'Add to comparison'
              }
            >
              {isInComparison ? <Check className="w-3 h-3" /> : <Plus className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      )}
    </div>
  )
);

ModelItem.displayName = 'ModelItem';

export default function ModelSelector({
  value,
  onChange,
  groups,
  fallbackOptions,
  className = '',
  ariaLabel = 'Select model',
  onAfterChange,
  disabled = false,
  disabledReason = 'Primary model is locked after comparison starts.',
  favoritesStorageKey = FAVORITES_KEY,
  recentStorageKey = RECENT_KEY,
  selectedComparisonModels = EMPTY_STRING_ARRAY,
  onComparisonModelsChange,
  comparisonDisabled = false,
  comparisonDisabledReason = 'Model comparison is locked after the first message.',
}: ModelSelectorProps) {
  const { user } = useAuth();
  const userId = user?.id;

  // Derive user-scoped storage keys
  const scopedFavoritesKey = userId ? `${favoritesStorageKey}_${userId}` : favoritesStorageKey;
  const scopedRecentKey = userId ? `${recentStorageKey}_${userId}` : recentStorageKey;

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recentModels, setRecentModels] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState(50); // Start with 50 items
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);

  // Load favorites and recent models from localStorage
  useEffect(() => {
    try {
      const savedFavorites = localStorage.getItem(scopedFavoritesKey);
      if (savedFavorites) {
        setFavorites(new Set(JSON.parse(savedFavorites)));
      } else {
        // Clear previous user's data when switching users
        setFavorites(new Set());
      }

      const savedRecent = localStorage.getItem(scopedRecentKey);
      if (savedRecent) {
        setRecentModels(JSON.parse(savedRecent));
      } else {
        // Clear previous user's data when switching users
        setRecentModels([]);
      }
    } catch (error) {
      console.warn('Failed to load model preferences:', error);
    }
  }, [scopedFavoritesKey, scopedRecentKey]);

  // Get all available models with provider info
  const allModels = useMemo(() => {
    // const start = performance.now(); // Disabled for performance
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
    // const end = performance.now();
    // console.log(`[ModelSelector] allModels computed in ${(end - start).toFixed(2)}ms, ${result.length} models`);
    return result;
  }, [groups, fallbackOptions]);

  // Get available provider tabs
  const providerTabs = useMemo<Tab[]>(() => {
    const selectedSet = new Set(selectedComparisonModels);

    // Check if any model in a provider group is selected for comparison
    const hasSelectedInProvider = (providerId: string): boolean => {
      return allModels.some(
        (model) => model.providerId === providerId && selectedSet.has(model.value)
      );
    };

    const hasAnySelected = selectedComparisonModels.length > 0;

    const tabs: Tab[] = [
      { id: 'all', label: 'All', count: allModels.length, hasSelected: hasAnySelected },
    ];

    if (groups && groups.length > 1) {
      groups.forEach((group) => {
        tabs.push({
          id: group.id,
          label: group.label,
          count: group.options.length,
          hasSelected: hasSelectedInProvider(group.id),
        });
      });
    }

    return tabs;
  }, [groups, allModels, selectedComparisonModels]);

  // Filter models based on search query and selected tab
  const filteredModels = useMemo(() => {
    let models = allModels;

    // Filter by selected tab
    if (selectedTab !== 'all') {
      models = models.filter((model) => model.providerId === selectedTab);
    }

    // Filter by search query
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

  // Organize models into sections - optimized single pass
  const organizedModels = useMemo(() => {
    // const start = performance.now(); // Disabled for performance
    const selectedModels: ModelOption[] = [];
    const favoriteModels: ModelOption[] = [];
    const recentFilteredModels: ModelOption[] = [];
    const otherModels: ModelOption[] = [];

    // Create set of selected model values for quick lookup
    const selectedSet = new Set([value, ...selectedComparisonModels]);

    // Single pass through filteredModels
    for (const model of filteredModels) {
      if (selectedSet.has(model.value)) {
        selectedModels.push(model);
      } else if (favorites.has(model.value)) {
        favoriteModels.push(model);
      } else if (recentModels.includes(model.value)) {
        recentFilteredModels.push(model);
      } else {
        otherModels.push(model);
      }
    }

    // Sort selected models to put primary model first, then comparison models
    selectedModels.sort((a, b) => {
      if (a.value === value) return -1;
      if (b.value === value) return 1;
      return 0;
    });

    // Sort recent models by recency
    recentFilteredModels.sort(
      (a, b) => recentModels.indexOf(a.value) - recentModels.indexOf(b.value)
    );

    const result = {
      selected: selectedModels,
      favorites: favoriteModels,
      recent: recentFilteredModels,
      other: otherModels,
    };
    // const end = performance.now();
    // console.log(`[ModelSelector] organizedModels computed in ${(end - start).toFixed(2)}ms, selected:${result.selected.length} fav:${result.favorites.length} recent:${result.recent.length} other:${result.other.length}`);
    return result;
  }, [filteredModels, favorites, recentModels, value, selectedComparisonModels]);

  const toggleFavorite = useCallback(
    (modelValue: string) => {
      if (disabled) return;
      const newFavorites = new Set(favorites);
      if (newFavorites.has(modelValue)) {
        newFavorites.delete(modelValue);
      } else {
        newFavorites.add(modelValue);
      }
      setFavorites(newFavorites);

      try {
        localStorage.setItem(scopedFavoritesKey, JSON.stringify([...newFavorites]));
      } catch (error) {
        console.warn('Failed to save favorites:', error);
      }
    },
    [disabled, favorites, scopedFavoritesKey]
  );

  const toggleComparison = useCallback(
    (modelValue: string) => {
      if (comparisonDisabled || !onComparisonModelsChange) return;

      const newSelection = selectedComparisonModels.includes(modelValue)
        ? selectedComparisonModels.filter((m) => m !== modelValue)
        : [...selectedComparisonModels, modelValue];

      onComparisonModelsChange(newSelection);
    },
    [comparisonDisabled, onComparisonModelsChange, selectedComparisonModels]
  );

  const handleModelSelect = useCallback(
    (modelValue: string) => {
      if (disabled) return;
      onChange(modelValue);
      setIsOpen(false);
      setSearchQuery('');
      setSelectedTab('all'); // Reset to All tab after selection

      // Update recent models (max 5, exclude favorites)
      if (!favorites.has(modelValue)) {
        const newRecent = [modelValue, ...recentModels.filter((m) => m !== modelValue)].slice(0, 5);
        setRecentModels(newRecent);

        try {
          localStorage.setItem(scopedRecentKey, JSON.stringify(newRecent));
        } catch (error) {
          console.warn('Failed to save recent models:', error);
        }
      }

      // Focus message input after model selection
      if (onAfterChange) {
        // Use setTimeout to ensure dropdown is closed first
        setTimeout(() => {
          onAfterChange();
        }, 0);
      }
    },
    [disabled, onChange, favorites, recentModels, onAfterChange, scopedRecentKey]
  );

  useEffect(() => {
    if (!isOpen) {
      setVisibleCount(50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (disabled && isOpen) {
      setIsOpen(false);
    }
  }, [disabled, isOpen]);

  // When filtered models change, reset highlighted index
  useEffect(() => {
    setHighlightedIndex(null);
  }, [
    searchQuery,
    selectedTab,
    organizedModels.selected.length,
    organizedModels.favorites.length,
    organizedModels.recent.length,
    organizedModels.other.length,
  ]);

  const currentModel = useMemo(
    () =>
      allModels.find((m) => m.value === value) ||
      allModels.find((m) => m.value.endsWith(`::${value}`)),
    [allModels, value]
  );

  // Set active tab to current model's provider when opening
  useEffect(() => {
    if (!isOpen) return;

    // Find model by exact value or by suffix if value doesn't include provider prefix
    const foundModel =
      allModels.find((m) => m.value === value) ||
      allModels.find((m) => m.value.endsWith(`::${value}`));

    if (foundModel) {
      if (foundModel.providerId && foundModel.providerId !== 'all') {
        const hasTab = providerTabs.some((tab) => tab.id === foundModel.providerId);
        if (hasTab) {
          setSelectedTab(foundModel.providerId);
        }
      }
    }
    // Only run when the dropdown opens or the selected value changes,
    // not on every re-render of models or tabs to avoid resetting user's manual tab choice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, value]);

  const displayText = currentModel?.label || value || 'Select model';

  const sections = useMemo<Section<ModelOption>[]>(() => {
    const result: Section<ModelOption>[] = [];

    if (organizedModels.selected.length > 0) {
      result.push({
        id: 'selected',
        header: (
          <div className="px-3 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide bg-zinc-50 dark:bg-zinc-900/50">
            Selected
          </div>
        ),
        items: organizedModels.selected,
      });
    }

    if (organizedModels.favorites.length > 0) {
      result.push({
        id: 'favorites',
        header: (
          <div className="px-3 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide bg-zinc-50 dark:bg-zinc-900/50">
            Favorites
          </div>
        ),
        items: organizedModels.favorites,
      });
    }

    if (organizedModels.recent.length > 0) {
      result.push({
        id: 'recent',
        header: (
          <div className="px-3 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide bg-zinc-50 dark:bg-zinc-900/50">
            Recent
          </div>
        ),
        items: organizedModels.recent,
      });
    }

    if (organizedModels.other.length > 0) {
      const otherHeader =
        organizedModels.selected.length > 0 ||
        organizedModels.favorites.length > 0 ||
        organizedModels.recent.length > 0 ? (
          <div className="px-3 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide bg-zinc-50 dark:bg-zinc-900/50">
            All Models
          </div>
        ) : undefined;

      result.push({
        id: 'other',
        header: otherHeader,
        items: organizedModels.other.slice(0, visibleCount),
      });
    }

    return result;
  }, [organizedModels, visibleCount]);

  const emptyState = useMemo(() => {
    if (allModels.length === 0) {
      return (
        <div className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">
          No models available. Please add a provider in settings.
        </div>
      );
    }

    if (filteredModels.length === 0) {
      return (
        <div className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">
          No models found matching &quot;{searchQuery}&quot;
        </div>
      );
    }

    return null;
  }, [allModels.length, filteredModels.length, searchQuery]);

  const footer =
    organizedModels.other.length > visibleCount ? (
      <div className="px-3 py-2 text-center text-xs text-slate-500">
        Showing {visibleCount} of {organizedModels.other.length} models. Scroll for more...
      </div>
    ) : null;

  const triggerButton = (
    <button
      onClick={() => {
        if (disabled) return;
        const start = performance.now();
        setIsOpen(!isOpen);
        requestAnimationFrame(() => {
          const end = performance.now();
          if (end - start > 100) {
            console.log(`[ModelSelector] Dropdown toggle took ${(end - start).toFixed(2)}ms`);
          }
        });
      }}
      className={`flex items-center gap-2 px-2 sm:px-3 h-8 sm:h-10 rounded-lg transition-colors min-w-0 w-full sm:min-w-48 sm:w-56 ${
        disabled
          ? 'bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed'
          : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800'
      }`}
      aria-label={ariaLabel}
      aria-expanded={isOpen}
      aria-haspopup="listbox"
      aria-disabled={disabled}
      disabled={disabled}
    >
      <span className="text-xs sm:text-sm truncate flex-1 text-left">{displayText}</span>
      {selectedComparisonModels.length > 0 && (
        <span className="flex-shrink-0 px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-[10px] font-bold text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
          +{selectedComparisonModels.length}
        </span>
      )}
      <ChevronDown
        className={`w-4 h-4 text-zinc-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
      />
    </button>
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
      dropdownAlign="left"
      listClassName=""
      tabs={providerTabs}
      activeTab={selectedTab}
      onTabChange={setSelectedTab}
      showTabCounts
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      sections={sections}
      renderItem={(model, index, isHighlighted) => (
        <ModelItem
          key={`model-${model.providerId}-${model.value}`}
          id={`model-item-${index}`}
          model={model}
          isSelected={model.value === value}
          isFavorite={favorites.has(model.value)}
          onToggleFavorite={toggleFavorite}
          onSelect={handleModelSelect}
          isHighlighted={isHighlighted}
          isInComparison={selectedComparisonModels.includes(model.value)}
          onToggleComparison={onComparisonModelsChange ? toggleComparison : undefined}
          comparisonDisabled={comparisonDisabled}
        />
      )}
      emptyState={emptyState}
      footer={footer}
      highlightedIndex={highlightedIndex}
      setHighlightedIndex={setHighlightedIndex}
      onEnter={(model) => handleModelSelect(model.value)}
      enableKeyboardNavigation
      getItemId={(index) => `model-item-${index}`}
      onScrollNearEnd={() => {
        if (visibleCount < organizedModels.other.length + 100) {
          setVisibleCount((prev) => Math.min(prev + 50, organizedModels.other.length + 100));
        }
      }}
      trigger={
        disabled ? <Tooltip content={disabledReason}>{triggerButton}</Tooltip> : triggerButton
      }
      extraHeader={
        selectedComparisonModels.length > 0 ? (
          <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 flex justify-between items-center">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {selectedComparisonModels.length} in comparison
            </span>
            <button
              onClick={() => onComparisonModelsChange?.([])}
              className="text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors"
            >
              Clear
            </button>
          </div>
        ) : undefined
      }
    />
  );
}
