import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, Star, StarOff, ChevronDown } from 'lucide-react';
import { type Group as TabGroup } from './TabbedSelect';

interface ModelOption {
  value: string;
  label: string;
  provider?: string;
  providerId?: string;
}

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  groups: TabGroup[] | null;
  fallbackOptions: ModelOption[];
  className?: string;
  ariaLabel?: string;
  onAfterChange?: () => void;
}

const FAVORITES_KEY = 'chatforge-favorite-models';
const RECENT_KEY = 'chatforge-recent-models';

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
  }: {
    model: ModelOption;
    isSelected: boolean;
    isFavorite: boolean;
    onToggleFavorite: (value: string) => void;
    onSelect: (value: string) => void;
    isHighlighted: boolean;
    id: string;
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
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [shouldRenderDropdown, setShouldRenderDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recentModels, setRecentModels] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState(50); // Start with 50 items
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load favorites and recent models from localStorage
  useEffect(() => {
    try {
      const savedFavorites = localStorage.getItem(FAVORITES_KEY);
      if (savedFavorites) {
        setFavorites(new Set(JSON.parse(savedFavorites)));
      }

      const savedRecent = localStorage.getItem(RECENT_KEY);
      if (savedRecent) {
        setRecentModels(JSON.parse(savedRecent));
      }
    } catch (error) {
      console.warn('Failed to load model preferences:', error);
    }
  }, []);

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
  const providerTabs = useMemo(() => {
    const tabs = [{ id: 'all', label: 'All', count: allModels.length }];

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
    const favoriteModels: ModelOption[] = [];
    const recentFilteredModels: ModelOption[] = [];
    const otherModels: ModelOption[] = [];

    // Single pass through filteredModels
    for (const model of filteredModels) {
      if (favorites.has(model.value)) {
        favoriteModels.push(model);
      } else if (recentModels.includes(model.value)) {
        recentFilteredModels.push(model);
      } else {
        otherModels.push(model);
      }
    }

    // Sort recent models by recency
    recentFilteredModels.sort(
      (a, b) => recentModels.indexOf(a.value) - recentModels.indexOf(b.value)
    );

    const result = {
      favorites: favoriteModels,
      recent: recentFilteredModels,
      other: otherModels,
    };
    // const end = performance.now();
    // console.log(`[ModelSelector] organizedModels computed in ${(end - start).toFixed(2)}ms, fav:${result.favorites.length} recent:${result.recent.length} other:${result.other.length}`);
    return result;
  }, [filteredModels, favorites, recentModels]);

  const toggleFavorite = useCallback(
    (modelValue: string) => {
      const newFavorites = new Set(favorites);
      if (newFavorites.has(modelValue)) {
        newFavorites.delete(modelValue);
      } else {
        newFavorites.add(modelValue);
      }
      setFavorites(newFavorites);

      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify([...newFavorites]));
      } catch (error) {
        console.warn('Failed to save favorites:', error);
      }
    },
    [favorites]
  );

  const handleModelSelect = useCallback(
    (modelValue: string) => {
      onChange(modelValue);
      setIsOpen(false);
      setSearchQuery('');
      setSelectedTab('all'); // Reset to All tab after selection

      // Update recent models (max 5, exclude favorites)
      if (!favorites.has(modelValue)) {
        const newRecent = [modelValue, ...recentModels.filter((m) => m !== modelValue)].slice(0, 5);
        setRecentModels(newRecent);

        try {
          localStorage.setItem(RECENT_KEY, JSON.stringify(newRecent));
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
    [onChange, favorites, recentModels, onAfterChange]
  );

  // Handle keyboard navigation
  // Build a flat list of visible models in the same order they are rendered
  const flatVisibleModels = useMemo(() => {
    const list: ModelOption[] = [];
    if (organizedModels.favorites.length > 0) list.push(...organizedModels.favorites);
    if (organizedModels.recent.length > 0) list.push(...organizedModels.recent);
    if (organizedModels.other.length > 0)
      list.push(...organizedModels.other.slice(0, visibleCount));
    return list;
  }, [organizedModels, visibleCount]);

  const scrollHighlightedIntoView = useCallback((index: number | null) => {
    if (index === null) return;
    const item = document.getElementById(`model-item-${index}`);
    if (item && listRef.current) {
      const parent = listRef.current;
      const itemTop = item.offsetTop;
      const itemBottom = itemTop + item.clientHeight;
      if (itemTop < parent.scrollTop) parent.scrollTop = itemTop - 8;
      else if (itemBottom > parent.scrollTop + parent.clientHeight)
        parent.scrollTop = itemBottom - parent.clientHeight + 8;
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setSearchQuery('');
      setSelectedTab('all');
      setHighlightedIndex(null);
      return;
    }

    if (!shouldRenderDropdown) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        const next = prev === null ? 0 : Math.min(prev + 1, flatVisibleModels.length - 1);
        scrollHighlightedIntoView(next);
        return next;
      });
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        const next =
          prev === null ? Math.max(flatVisibleModels.length - 1, 0) : Math.max(prev - 1, 0);
        scrollHighlightedIntoView(next);
        return next;
      });
      return;
    }

    if (e.key === 'Enter') {
      if (highlightedIndex !== null && flatVisibleModels[highlightedIndex]) {
        e.preventDefault();
        handleModelSelect(flatVisibleModels[highlightedIndex].value);
      }
      return;
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
        setSelectedTab('all');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Defer dropdown rendering to next frame for smoother opening
  useEffect(() => {
    if (isOpen) {
      // Use setTimeout to defer heavy rendering to next frame
      const timer = setTimeout(() => {
        setShouldRenderDropdown(true);
      }, 0);
      return () => clearTimeout(timer);
    } else {
      setShouldRenderDropdown(false);
      setVisibleCount(50); // Reset visible count when closing
    }
  }, [isOpen]);

  // Infinite scroll handler for large lists
  useEffect(() => {
    if (!shouldRenderDropdown || !listRef.current) return;

    const handleScroll = () => {
      const element = listRef.current;
      if (!element) return;

      const { scrollTop, scrollHeight, clientHeight } = element;
      const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;

      // Load more when scrolled 80% down
      if (scrollPercentage > 0.8 && visibleCount < organizedModels.other.length + 100) {
        setVisibleCount((prev) => Math.min(prev + 50, organizedModels.other.length + 100));
      }
    };

    const element = listRef.current;
    element.addEventListener('scroll', handleScroll);
    return () => element.removeEventListener('scroll', handleScroll);
  }, [shouldRenderDropdown, visibleCount, organizedModels.other.length]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (shouldRenderDropdown && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [shouldRenderDropdown]);

  // When filtered models change, reset highlighted index
  useEffect(() => {
    setHighlightedIndex(null);
  }, [
    searchQuery,
    selectedTab,
    organizedModels.favorites.length,
    organizedModels.recent.length,
    organizedModels.other.length,
  ]);

  const currentModel = useMemo(
    () => allModels.find((m) => m.value === value) || allModels.find((m) => m.value.endsWith(`::${value}`)),
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
  }, [isOpen, value, allModels, providerTabs]);

  const displayText = currentModel?.label || value || 'Select model';

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        onClick={() => {
          const start = performance.now();
          setIsOpen(!isOpen);
          requestAnimationFrame(() => {
            const end = performance.now();
            if (end - start > 100) {
              // Only log if slow
              console.log(`[ModelSelector] Dropdown toggle took ${(end - start).toFixed(2)}ms`);
            }
          });
        }}
        className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors min-w-0 w-full sm:min-w-48 sm:w-56"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className="text-sm truncate flex-1 text-left">{displayText}</span>
        <ChevronDown
          className={`w-4 h-4 text-zinc-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 w-80 mt-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg max-h-[70vh] overflow-hidden z-50">
          {!shouldRenderDropdown ? (
            <div className="p-8 text-center text-zinc-500">Loading...</div>
          ) : (
            <>
              {/* Provider Tabs */}
              {providerTabs.length > 1 && (
                <div
                  className="flex flex-nowrap overflow-x-auto border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50"
                  onWheel={(e) => {
                    e.preventDefault();
                    e.currentTarget.scrollLeft += e.deltaY;
                  }}
                >
                  {providerTabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => {
                        setSelectedTab(tab.id);
                        // Keep focus on search input
                        if (searchInputRef.current) {
                          searchInputRef.current.focus();
                        }
                      }}
                      className={`flex-1 px-3 py-2 text-xs font-medium text-center border-b-2 transition-colors ${
                        selectedTab === tab.id
                          ? 'border-zinc-800 dark:border-zinc-200 text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-900'
                          : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <div className="truncate">{tab.label}</div>
                      <div className="text-xs opacity-75">({tab.count})</div>
                    </button>
                  ))}
                </div>
              )}

              {/* Search Header */}
              <div className="p-2 border-b border-zinc-200 dark:border-zinc-800">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Search models..."
                    className="w-full pl-10 pr-3 py-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 text-sm"
                  />
                </div>
              </div>

              {/* Model List */}
              <div
                ref={listRef}
                className="overflow-y-auto max-h-[75vh]"
                style={{ contentVisibility: 'auto' }}
              >
                {organizedModels.favorites.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide bg-zinc-50 dark:bg-zinc-900/50">
                      Favorites
                    </div>
                    {organizedModels.favorites.map((model, idx) => (
                      <ModelItem
                        key={`fav-${model.providerId}-${model.value}`}
                        id={`model-item-${idx}`}
                        model={model}
                        isSelected={model.value === value}
                        isFavorite={favorites.has(model.value)}
                        onToggleFavorite={toggleFavorite}
                        onSelect={handleModelSelect}
                        isHighlighted={highlightedIndex === idx}
                      />
                    ))}
                  </div>
                )}

                {organizedModels.recent.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide bg-zinc-50 dark:bg-zinc-900/50">
                      Recent
                    </div>
                    {organizedModels.recent.map((model, rIdx) => {
                      const idx = organizedModels.favorites.length + rIdx;
                      return (
                        <ModelItem
                          key={`recent-${model.providerId}-${model.value}`}
                          id={`model-item-${idx}`}
                          model={model}
                          isSelected={model.value === value}
                          isFavorite={favorites.has(model.value)}
                          onToggleFavorite={toggleFavorite}
                          onSelect={handleModelSelect}
                          isHighlighted={highlightedIndex === idx}
                        />
                      );
                    })}
                  </div>
                )}

                {organizedModels.other.length > 0 && (
                  <div>
                    {(organizedModels.favorites.length > 0 ||
                      organizedModels.recent.length > 0) && (
                      <div className="px-3 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide bg-zinc-50 dark:bg-zinc-900/50">
                        All Models
                      </div>
                    )}
                    {organizedModels.other.slice(0, visibleCount).map((model, oIdx) => {
                      const idx =
                        organizedModels.favorites.length + organizedModels.recent.length + oIdx;
                      return (
                        <ModelItem
                          key={`other-${model.providerId}-${model.value}`}
                          id={`model-item-${idx}`}
                          model={model}
                          isSelected={model.value === value}
                          isFavorite={favorites.has(model.value)}
                          onToggleFavorite={toggleFavorite}
                          onSelect={handleModelSelect}
                          isHighlighted={highlightedIndex === idx}
                        />
                      );
                    })}
                    {organizedModels.other.length > visibleCount && (
                      <div className="px-3 py-2 text-center text-xs text-slate-500">
                        Showing {visibleCount} of {organizedModels.other.length} models. Scroll for
                        more...
                      </div>
                    )}
                  </div>
                )}

                {allModels.length === 0 ? (
                  <div className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">
                    No models available. Please add a provider in settings.
                  </div>
                ) : (
                  filteredModels.length === 0 && (
                    <div className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">
                      No models found matching &quot;{searchQuery}&quot;
                    </div>
                  )
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
