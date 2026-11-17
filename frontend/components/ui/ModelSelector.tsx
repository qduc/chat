'use client';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Toggle as BaseToggle } from '@base-ui/react/toggle';
import { Star, ChevronDown, Check, Plus, Search, RefreshCw, Loader2 } from 'lucide-react';
import Tooltip from './Tooltip';
import { useAuth } from '../../contexts/AuthContext';
import { cn } from '../../lib/cn';
import { floatingPanelClasses } from './Menu';
import { Button } from './Button';

export type Option = { value: string; label: string };
export type Group = { id: string; label: string; options: Option[] };

interface ModelOption extends Option {
  provider?: string;
  providerId?: string;
}

interface ModelGroup {
  value: string;
  label?: string;
  items: ModelOption[];
}

interface ProviderTab {
  id: string;
  label: string;
  count: number;
  hasSelected: boolean;
}

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  groups: Group[] | null;
  fallbackOptions: (Option & { provider?: string })[];
  className?: string;
  ariaLabel?: string;
  onAfterChange?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  favoritesStorageKey?: string;
  recentStorageKey?: string;
  // Controlled open state
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Comparison props
  selectedComparisonModels?: string[];
  onComparisonModelsChange?: (models: string[]) => void;
  comparisonDisabled?: boolean;
  comparisonDisabledReason?: string;
  // Refresh the model list from providers
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

const FAVORITES_KEY = 'chatforge-favorite-models';
const RECENT_KEY = 'chatforge-recent-models';
const EMPTY_STRING_ARRAY: string[] = [];
const PAGE_SIZE = 50;

/** Keyboard shortcuts that act on the highlighted model while the search box has focus. */
const FAVORITE_SHORTCUT = 'KeyF';
const COMPARE_SHORTCUT = 'KeyC';

const rowActionClasses =
  'flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-control text-fg-subtle transition-colors hover:bg-emphasis hover:text-fg [&_svg]:size-4';

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
  isOpen,
  onOpenChange,
  selectedComparisonModels = EMPTY_STRING_ARRAY,
  onComparisonModelsChange,
  comparisonDisabled = false,
  comparisonDisabledReason = 'Model comparison is locked after the first message.',
  onRefresh,
  isRefreshing = false,
}: ModelSelectorProps) {
  const { user } = useAuth();
  const userId = user?.id;

  // User-scoped storage keys
  const scopedFavoritesKey = userId ? `${favoritesStorageKey}_${userId}` : favoritesStorageKey;
  const scopedRecentKey = userId ? `${recentStorageKey}_${userId}` : recentStorageKey;

  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isControlled = typeof isOpen !== 'undefined';
  const effectiveIsOpen = isControlled ? isOpen : internalIsOpen;

  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recentModels, setRecentModels] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const highlightedRef = useRef<ModelOption | undefined>(undefined);

  const canCompare = Boolean(onComparisonModelsChange);

  // Load favorites and recent models from localStorage
  useEffect(() => {
    try {
      const savedFavorites = localStorage.getItem(scopedFavoritesKey);
      // Clear the previous user's data when switching users
      setFavorites(savedFavorites ? new Set(JSON.parse(savedFavorites)) : new Set());
      const savedRecent = localStorage.getItem(scopedRecentKey);
      setRecentModels(savedRecent ? JSON.parse(savedRecent) : []);
    } catch (error) {
      console.warn('Failed to load model preferences:', error);
    }
  }, [scopedFavoritesKey, scopedRecentKey]);

  // All available models with provider info
  const allModels = useMemo<ModelOption[]>(() => {
    if (groups && groups.length > 0) {
      return groups.flatMap((group) =>
        group.options.map((option) => ({
          ...option,
          provider: group.label,
          providerId: group.id,
        }))
      );
    }
    return fallbackOptions.map((option) => ({
      ...option,
      provider: option.provider || 'Default',
      providerId: 'default',
    }));
  }, [groups, fallbackOptions]);

  const providerTabs = useMemo<ProviderTab[]>(() => {
    const selectedSet = new Set(selectedComparisonModels);
    const tabs: ProviderTab[] = [
      {
        id: 'all',
        label: 'All',
        count: allModels.length,
        hasSelected: selectedComparisonModels.length > 0,
      },
    ];
    if (groups && groups.length > 1) {
      for (const group of groups) {
        tabs.push({
          id: group.id,
          label: group.label,
          count: group.options.length,
          hasSelected: allModels.some(
            (model) => model.providerId === group.id && selectedSet.has(model.value)
          ),
        });
      }
    }
    return tabs;
  }, [groups, allModels, selectedComparisonModels]);

  // Filter by provider and search query
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

  // Organize into Selected / Favorites / Recent / All, in a single pass
  const organizedModels = useMemo(() => {
    const selected: ModelOption[] = [];
    const favoriteModels: ModelOption[] = [];
    const recent: ModelOption[] = [];
    const other: ModelOption[] = [];
    const selectedSet = new Set([value, ...selectedComparisonModels]);

    for (const model of filteredModels) {
      if (selectedSet.has(model.value)) selected.push(model);
      else if (favorites.has(model.value)) favoriteModels.push(model);
      else if (recentModels.includes(model.value)) recent.push(model);
      else other.push(model);
    }

    // Primary model first, then comparison models
    selected.sort((a, b) => (a.value === value ? -1 : b.value === value ? 1 : 0));
    recent.sort((a, b) => recentModels.indexOf(a.value) - recentModels.indexOf(b.value));

    return { selected, favorites: favoriteModels, recent, other };
  }, [filteredModels, favorites, recentModels, value, selectedComparisonModels]);

  const modelGroups = useMemo<ModelGroup[]>(() => {
    const result: ModelGroup[] = [];
    if (organizedModels.selected.length)
      result.push({ value: 'selected', label: 'Selected', items: organizedModels.selected });
    if (organizedModels.favorites.length)
      result.push({ value: 'favorites', label: 'Favorites', items: organizedModels.favorites });
    if (organizedModels.recent.length)
      result.push({ value: 'recent', label: 'Recent', items: organizedModels.recent });
    if (organizedModels.other.length) {
      result.push({
        value: 'other',
        label: result.length ? 'All Models' : undefined,
        items: organizedModels.other.slice(0, visibleCount),
      });
    }
    return result;
  }, [organizedModels, visibleCount]);

  const handleSetIsOpen = useCallback(
    (open: boolean) => {
      if (disabled && open) return;
      if (!isControlled) setInternalIsOpen(open);
      onOpenChange?.(open);
      if (!open) {
        setSearchQuery('');
        setSelectedTab('all');
      }
    },
    [disabled, isControlled, onOpenChange]
  );

  const toggleFavorite = useCallback(
    (modelValue: string) => {
      if (disabled) return;
      const next = new Set(favorites);
      if (next.has(modelValue)) next.delete(modelValue);
      else next.add(modelValue);
      setFavorites(next);
      try {
        localStorage.setItem(scopedFavoritesKey, JSON.stringify([...next]));
      } catch (error) {
        console.warn('Failed to save favorites:', error);
      }
    },
    [disabled, favorites, scopedFavoritesKey]
  );

  const toggleComparison = useCallback(
    (modelValue: string) => {
      if (comparisonDisabled || !onComparisonModelsChange || modelValue === value) return;
      onComparisonModelsChange(
        selectedComparisonModels.includes(modelValue)
          ? selectedComparisonModels.filter((m) => m !== modelValue)
          : [...selectedComparisonModels, modelValue]
      );
    },
    [comparisonDisabled, onComparisonModelsChange, selectedComparisonModels, value]
  );

  const handleModelSelect = useCallback(
    (modelValue: string) => {
      if (disabled) return;
      onChange(modelValue);
      handleSetIsOpen(false);

      // Update recent models (max 5, excluding favorites)
      if (!favorites.has(modelValue)) {
        const nextRecent = [modelValue, ...recentModels.filter((m) => m !== modelValue)].slice(
          0,
          5
        );
        setRecentModels(nextRecent);
        try {
          localStorage.setItem(scopedRecentKey, JSON.stringify(nextRecent));
        } catch (error) {
          console.warn('Failed to save recent models:', error);
        }
      }

      // Focus the message input once the popup has closed
      if (onAfterChange) setTimeout(() => onAfterChange(), 0);
    },
    [disabled, onChange, favorites, recentModels, onAfterChange, scopedRecentKey, handleSetIsOpen]
  );

  useEffect(() => {
    if (!effectiveIsOpen) setVisibleCount(PAGE_SIZE);
  }, [effectiveIsOpen]);

  useEffect(() => {
    if (disabled && effectiveIsOpen) handleSetIsOpen(false);
  }, [disabled, effectiveIsOpen, handleSetIsOpen]);

  const currentModel = useMemo(
    () =>
      allModels.find((m) => m.value === value) ||
      allModels.find((m) => m.value.endsWith(`::${value}`)),
    [allModels, value]
  );

  // When opening, jump to the current model's provider
  useEffect(() => {
    if (!effectiveIsOpen || !currentModel?.providerId) return;
    if (providerTabs.some((tab) => tab.id === currentModel.providerId)) {
      setSelectedTab(currentModel.providerId);
    }
    // Only when the popup opens or the value changes, so a manual tab choice isn't reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveIsOpen, value]);

  const handleListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (
      (scrollTop + clientHeight) / scrollHeight > 0.8 &&
      visibleCount < organizedModels.other.length
    ) {
      setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, organizedModels.other.length));
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const target = highlightedRef.current;
    if (!target) return;
    if (e.code === FAVORITE_SHORTCUT) {
      e.preventDefault();
      toggleFavorite(target.value);
    } else if (e.code === COMPARE_SHORTCUT && canCompare) {
      e.preventDefault();
      toggleComparison(target.value);
    }
  };

  const displayText = currentModel?.label || value || 'Select model';
  const emptyText =
    allModels.length === 0
      ? 'No models available. Please add a provider in settings.'
      : `No models found matching "${searchQuery}"`;

  const trigger = (
    <Combobox.Trigger
      aria-label={ariaLabel}
      className={cn(
        'flex h-9 w-full min-w-0 items-center gap-2 rounded-control border border-line bg-surface px-3 text-sm text-fg transition-colors touch-target focus-ring sm:w-auto sm:max-w-80 sm:min-w-48',
        'hover:bg-muted data-popup-open:bg-muted',
        'disabled:cursor-not-allowed disabled:opacity-50'
      )}
    >
      <span className="min-w-0 flex-1 truncate text-left">{displayText}</span>
      {selectedComparisonModels.length > 0 && (
        <span className="shrink-0 rounded-full bg-emphasis px-2 text-xs text-fg-muted">
          +{selectedComparisonModels.length}
        </span>
      )}
      <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
    </Combobox.Trigger>
  );

  return (
    <div className={cn('min-w-0', className)}>
      <Combobox.Root<ModelOption>
        items={modelGroups}
        filter={null}
        value={currentModel ?? null}
        onValueChange={(next) => {
          if (next) handleModelSelect(next.value);
        }}
        isItemEqualToValue={(a, b) => a.value === b.value}
        itemToStringLabel={(item) => item.label}
        inputValue={searchQuery}
        onInputValueChange={(next) => setSearchQuery(next)}
        open={effectiveIsOpen}
        onOpenChange={(open) => handleSetIsOpen(open)}
        onItemHighlighted={(item) => {
          highlightedRef.current = item;
        }}
        disabled={disabled}
        // Keep Tab inside the popup so the provider filter and Clear stay keyboard-reachable.
        modal
      >
        {disabled ? (
          <Tooltip content={disabledReason} className="flex min-w-0">
            {trigger}
          </Tooltip>
        ) : (
          trigger
        )}
        <Combobox.Portal>
          <Combobox.Positioner
            align="start"
            sideOffset={8}
            collisionPadding={8}
            className="z-50 outline-none"
          >
            <Combobox.Popup
              aria-label={ariaLabel}
              className={cn(
                floatingPanelClasses,
                'flex max-h-(--available-height) w-80 max-w-(--available-width) flex-col overflow-hidden'
              )}
            >
              {providerTabs.length > 1 && (
                <ToggleGroup
                  aria-label="Filter by provider"
                  value={[selectedTab]}
                  onValueChange={(next) => {
                    if (next.length) setSelectedTab(String(next[0]));
                  }}
                  className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2"
                >
                  {providerTabs.map((tab) => (
                    <BaseToggle
                      key={tab.id}
                      value={tab.id}
                      className="flex h-8 shrink-0 items-center gap-2 rounded-control px-3 text-xs whitespace-nowrap text-fg-muted transition-colors touch-target focus-ring-inset hover:bg-muted hover:text-fg data-pressed:bg-emphasis data-pressed:text-fg"
                    >
                      {tab.label}
                      <span className="text-fg-subtle">{tab.count}</span>
                      {tab.hasSelected && (
                        <span
                          aria-label="Has models in comparison"
                          className="size-1.5 shrink-0 rounded-full bg-accent"
                        />
                      )}
                    </BaseToggle>
                  ))}
                </ToggleGroup>
              )}

              <div className="relative shrink-0 border-b border-line p-2">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-fg-subtle"
                />
                <Combobox.Input
                  aria-label="Search models"
                  aria-keyshortcuts={canCompare ? 'Alt+F Alt+C' : 'Alt+F'}
                  placeholder="Search models..."
                  onKeyDown={handleSearchKeyDown}
                  className="h-9 w-full rounded-control border border-line-strong bg-surface pr-3 pl-8 text-sm text-fg placeholder:text-fg-subtle focus-ring"
                />
              </div>

              {selectedComparisonModels.length > 0 && (
                <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
                  <span className="text-xs text-fg-muted">
                    {selectedComparisonModels.length} in comparison
                  </span>
                  <button
                    type="button"
                    onClick={() => onComparisonModelsChange?.([])}
                    className="rounded-control px-2 text-xs font-medium text-fg-muted hover:text-fg focus-ring"
                  >
                    Clear
                  </button>
                </div>
              )}

              <Combobox.Empty className="px-3 py-6 text-center text-sm text-fg-muted empty:hidden">
                {emptyText}
              </Combobox.Empty>

              <Combobox.List
                onScroll={handleListScroll}
                className="min-h-0 flex-1 overflow-y-auto p-1 empty:hidden"
              >
                {(group: ModelGroup) => (
                  <Combobox.Group key={group.value} items={group.items} className="pb-1 last:pb-0">
                    {group.label && (
                      <Combobox.GroupLabel className="px-3 pt-2 pb-1 text-xs text-fg-subtle">
                        {group.label}
                      </Combobox.GroupLabel>
                    )}
                    <Combobox.Collection>
                      {(model: ModelOption) => (
                        <ModelRow
                          key={`${model.providerId}-${model.value}`}
                          model={model}
                          isPrimary={model.value === value}
                          isFavorite={favorites.has(model.value)}
                          isInComparison={selectedComparisonModels.includes(model.value)}
                          canCompare={canCompare}
                          comparisonDisabled={comparisonDisabled}
                          comparisonDisabledReason={comparisonDisabledReason}
                          onToggleFavorite={toggleFavorite}
                          onToggleComparison={toggleComparison}
                        />
                      )}
                    </Combobox.Collection>
                  </Combobox.Group>
                )}
              </Combobox.List>

              {organizedModels.other.length > visibleCount && (
                <div className="shrink-0 border-t border-line px-3 py-2 text-center text-xs text-fg-subtle">
                  Showing {visibleCount} of {organizedModels.other.length} models. Scroll for
                  more...
                </div>
              )}
              <div
                className={cn(
                  'min-h-10 shrink-0 items-center justify-between gap-2 border-t border-line py-1 pr-1 pl-3',
                  onRefresh ? 'flex' : 'hidden sm:flex'
                )}
              >
                <span className="hidden text-xs text-fg-subtle sm:inline">
                  <kbd className="font-sans">Alt+F</kbd> favorite
                  {canCompare && (
                    <>
                      {' · '}
                      <kbd className="font-sans">Alt+C</kbd> compare
                    </>
                  )}
                </span>
                {onRefresh && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onRefresh}
                    disabled={isRefreshing}
                    title="Refresh model list"
                    className="ml-auto"
                  >
                    {isRefreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    Refresh
                  </Button>
                )}
              </div>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  );
}

interface ModelRowProps {
  model: ModelOption;
  isPrimary: boolean;
  isFavorite: boolean;
  isInComparison: boolean;
  canCompare: boolean;
  comparisonDisabled: boolean;
  comparisonDisabledReason: string;
  onToggleFavorite: (value: string) => void;
  onToggleComparison: (value: string) => void;
}

/**
 * One option. The favorite and compare controls are pointer targets inside the option;
 * keyboard and screen-reader users reach the same actions with Alt+F / Alt+C on the
 * highlighted option (an option may not contain focusable controls).
 */
const ModelRow = React.memo(function ModelRow({
  model,
  isPrimary,
  isFavorite,
  isInComparison,
  canCompare,
  comparisonDisabled,
  comparisonDisabledReason,
  onToggleFavorite,
  onToggleComparison,
}: ModelRowProps) {
  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const stateParts = [
    isPrimary && 'selected',
    isFavorite && 'favorite',
    isInComparison && 'in comparison',
  ].filter(Boolean);

  return (
    <Combobox.Item
      value={model}
      aria-description={stateParts.length ? stateParts.join(', ') : undefined}
      className="group/row flex cursor-default items-center gap-1 rounded-control pr-1 text-sm outline-none select-none data-highlighted:bg-muted"
    >
      <span
        aria-hidden="true"
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        onPointerDown={stop}
        onClick={(e) => {
          stop(e);
          onToggleFavorite(model.value);
        }}
        className={cn(rowActionClasses, isFavorite && 'text-fg')}
      >
        <Star className={cn(isFavorite && 'fill-current')} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col py-2">
        <span className={cn('truncate', isPrimary ? 'font-medium text-fg' : 'text-fg')}>
          {model.label}
        </span>
        {model.provider && (
          <span className="truncate text-xs text-fg-subtle">{model.provider}</span>
        )}
      </span>
      {canCompare &&
        (isPrimary ? (
          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center">
            <Check className="size-4 text-accent" />
          </span>
        ) : (
          <span
            aria-hidden="true"
            title={
              comparisonDisabled
                ? comparisonDisabledReason
                : isInComparison
                  ? 'Remove from comparison'
                  : 'Add to comparison'
            }
            onPointerDown={stop}
            onClick={(e) => {
              stop(e);
              if (!comparisonDisabled) onToggleComparison(model.value);
            }}
            className={cn(
              rowActionClasses,
              isInComparison &&
                'bg-primary text-on-primary hover:bg-primary-hover hover:text-on-primary',
              comparisonDisabled && 'cursor-not-allowed opacity-50'
            )}
          >
            {isInComparison ? <Check /> : <Plus />}
          </span>
        ))}
    </Combobox.Item>
  );
});
