import React, { useState, useEffect, useRef, useMemo } from 'react';
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
}

const FAVORITES_KEY = 'chatforge-favorite-models';
const RECENT_KEY = 'chatforge-recent-models';

export default function ModelSelector({
  value,
  onChange,
  groups,
  fallbackOptions,
  className = '',
  ariaLabel = 'Select model'
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recentModels, setRecentModels] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState<string>('all');

  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    if (groups && groups.length > 0) {
      return groups.flatMap(group =>
        group.options.map(option => ({
          ...option,
          provider: group.label,
          providerId: group.id
        }))
      );
    }
    return fallbackOptions.map(option => ({
      ...option,
      provider: option.provider || 'Default',
      providerId: 'default'
    }));
  }, [groups, fallbackOptions]);

  // Get available provider tabs
  const providerTabs = useMemo(() => {
    const tabs = [{ id: 'all', label: 'All', count: allModels.length }];

    if (groups && groups.length > 1) {
      groups.forEach(group => {
        tabs.push({
          id: group.id,
          label: group.label,
          count: group.options.length
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
      models = models.filter(model => model.providerId === selectedTab);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      models = models.filter(model =>
        model.label.toLowerCase().includes(query) ||
        model.value.toLowerCase().includes(query) ||
        (model.provider && model.provider.toLowerCase().includes(query))
      );
    }

    return models;
  }, [allModels, searchQuery, selectedTab]);

  // Organize models into sections
  const organizedModels = useMemo(() => {
    const favoriteModels = filteredModels.filter(model => favorites.has(model.value));
    const recentFilteredModels = filteredModels.filter(model =>
      recentModels.includes(model.value) && !favorites.has(model.value)
    ).sort((a, b) => recentModels.indexOf(a.value) - recentModels.indexOf(b.value));
    const otherModels = filteredModels.filter(model =>
      !favorites.has(model.value) && !recentModels.includes(model.value)
    );

    return {
      favorites: favoriteModels,
      recent: recentFilteredModels,
      other: otherModels
    };
  }, [filteredModels, favorites, recentModels]);

  const toggleFavorite = (modelValue: string) => {
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
  };

  const handleModelSelect = (modelValue: string) => {
    onChange(modelValue);
    setIsOpen(false);
    setSearchQuery('');
    setSelectedTab('all'); // Reset to All tab after selection

    // Update recent models (max 5, exclude favorites)
    if (!favorites.has(modelValue)) {
      const newRecent = [modelValue, ...recentModels.filter(m => m !== modelValue)].slice(0, 5);
      setRecentModels(newRecent);

      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(newRecent));
      } catch (error) {
        console.warn('Failed to save recent models:', error);
      }
    }
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setSearchQuery('');
      setSelectedTab('all');
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

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const currentModel = allModels.find(model => model.value === value);
  const displayText = currentModel?.label || value || 'Select model';

  const ModelItem = ({ model }: { model: ModelOption }) => (
    <div
      key={model.value}
      className={`w-full flex items-center hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors ${model.value === value ? 'bg-blue-50 dark:bg-blue-900/20' : ''
        }`}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleFavorite(model.value);
        }}
        className="flex items-center justify-center w-10 h-9 hover:bg-slate-200 dark:hover:bg-neutral-700 transition-colors"
        title={favorites.has(model.value) ? 'Remove from favorites' : 'Add to favorites'}
      >
        {favorites.has(model.value) ? (
          <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
        ) : (
          <StarOff className="w-3.5 h-3.5 text-slate-400" />
        )}
      </button>
      <button
        onClick={() => handleModelSelect(model.value)}
        className={`flex-1 min-w-0 px-3 py-2 text-left transition-colors ${model.value === value ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300'
          }`}
      >
        <div className="text-sm font-medium truncate leading-tight">{model.label}</div>
        {model.provider && (
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate leading-tight">
            {model.provider}
          </div>
        )}
      </button>
    </div>
  );

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 rounded-lg hover:bg-slate-50 dark:hover:bg-neutral-800 transition-colors min-w-48 w-56"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className="text-sm truncate flex-1 text-left">{displayText}</span>
        <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 w-80 mt-2 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 rounded-lg shadow-lg max-h-180 overflow-hidden z-50">
          {/* Provider Tabs */}
          {providerTabs.length > 1 && (
            <div
              className="flex flex-nowrap overflow-x-auto border-b border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800/50"
              onWheel={(e) => {
                e.preventDefault();
                e.currentTarget.scrollLeft += e.deltaY;
              }}
            >
              {providerTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setSelectedTab(tab.id)}
                  className={`flex-1 px-3 py-2 text-xs font-medium text-center border-b-2 transition-colors ${selectedTab === tab.id
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-neutral-900'
                      : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-700'
                    }`}
                >
                  <div className="truncate">{tab.label}</div>
                  <div className="text-xs opacity-75">({tab.count})</div>
                </button>
              ))}
            </div>
          )}

          {/* Search Header */}
          <div className="p-2 border-b border-slate-200 dark:border-neutral-700">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search models..."
                className="w-full pl-10 pr-3 py-1.5 bg-slate-50 dark:bg-neutral-800 border border-slate-200 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          </div>

          {/* Model List */}
          <div className="overflow-y-auto max-h-168">
            {organizedModels.favorites.length > 0 && (
              <div>
                <div className="px-3 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide bg-slate-50 dark:bg-neutral-800/50">
                  Favorites
                </div>
                {organizedModels.favorites.map(model => (
                  <ModelItem key={`fav-${model.value}`} model={model} />
                ))}
              </div>
            )}

            {organizedModels.recent.length > 0 && (
              <div>
                <div className="px-3 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide bg-slate-50 dark:bg-neutral-800/50">
                  Recent
                </div>
                {organizedModels.recent.map(model => (
                  <ModelItem key={`recent-${model.value}`} model={model} />
                ))}
              </div>
            )}

            {organizedModels.other.length > 0 && (
              <div>
                {(organizedModels.favorites.length > 0 || organizedModels.recent.length > 0) && (
                  <div className="px-3 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide bg-slate-50 dark:bg-neutral-800/50">
                    All Models
                  </div>
                )}
                {organizedModels.other.map(model => (
                  <ModelItem key={`other-${model.value}`} model={model} />
                ))}
              </div>
            )}

            {filteredModels.length === 0 && (
              <div className="px-3 py-6 text-center text-slate-500 dark:text-slate-400">
                No models found matching &quot;{searchQuery}&quot;
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
