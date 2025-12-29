import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Search } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  provider?: string;
  providerId?: string;
}

export interface Tab {
  id: string;
  label: string;
  count?: number;
  hasSelected?: boolean;
}

export interface Section<T> {
  id: string;
  header?: React.ReactNode;
  items: T[];
}

interface ModelSelectBaseProps<T extends SelectOption> {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  onClose?: () => void;

  ariaLabel?: string;
  className?: string;
  trigger: React.ReactNode;
  dropdownAlign?: 'left' | 'right';
  dropdownClassName?: string;
  listClassName?: string;

  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  showTabCounts?: boolean;

  searchQuery: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;

  sections: Section<T>[];
  renderItem: (item: T, index: number, isHighlighted: boolean) => React.ReactNode;
  emptyState?: React.ReactNode;
  footer?: React.ReactNode;

  highlightedIndex: number | null;
  setHighlightedIndex: (index: number | null | ((prev: number | null) => number | null)) => void;
  onEnter?: (item: T) => void;
  enableKeyboardNavigation?: boolean;
  getItemId?: (index: number) => string;

  onScrollNearEnd?: () => void;
  scrollThreshold?: number;
  extraHeader?: React.ReactNode;
}

export default function ModelSelectBase<T extends SelectOption>({
  isOpen,
  setIsOpen,
  onClose,
  ariaLabel = 'Select model',
  className = '',
  trigger,
  dropdownAlign = 'left',
  dropdownClassName = '',
  listClassName = '',
  tabs,
  activeTab,
  onTabChange,
  showTabCounts = false,
  searchQuery,
  onSearchChange,
  searchPlaceholder = 'Search models...',
  sections,
  renderItem,
  emptyState,
  footer,
  highlightedIndex,
  setHighlightedIndex,
  onEnter,
  enableKeyboardNavigation = false,
  getItemId,
  onScrollNearEnd,
  scrollThreshold = 0.8,
  extraHeader,
}: ModelSelectBaseProps<T>) {
  const [shouldRenderDropdown, setShouldRenderDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const flatItems = useMemo(() => sections.flatMap((section) => section.items), [sections]);

  const closeDropdown = useCallback(() => {
    if (onClose) onClose();
    setIsOpen(false);
  }, [onClose, setIsOpen]);

  const scrollHighlightedIntoView = useCallback(
    (index: number | null) => {
      if (index === null || !getItemId || !listRef.current) return;
      const item = document.getElementById(getItemId(index));
      if (!item) return;

      const parent = listRef.current;
      const itemTop = item.offsetTop;
      const itemBottom = itemTop + item.clientHeight;
      if (itemTop < parent.scrollTop) parent.scrollTop = itemTop - 8;
      else if (itemBottom > parent.scrollTop + parent.clientHeight)
        parent.scrollTop = itemBottom - parent.clientHeight + 8;
    },
    [getItemId]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!enableKeyboardNavigation) return;

      if (e.key === 'Escape') {
        setHighlightedIndex(null);
        closeDropdown();
        return;
      }

      if (!shouldRenderDropdown) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          const next = prev === null ? 0 : Math.min(prev + 1, flatItems.length - 1);
          scrollHighlightedIntoView(next);
          return next;
        });
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          const next = prev === null ? Math.max(flatItems.length - 1, 0) : Math.max(prev - 1, 0);
          scrollHighlightedIntoView(next);
          return next;
        });
        return;
      }

      if (e.key === 'Enter') {
        if (highlightedIndex !== null && flatItems[highlightedIndex] && onEnter) {
          e.preventDefault();
          onEnter(flatItems[highlightedIndex]);
        }
      }
    },
    [
      enableKeyboardNavigation,
      shouldRenderDropdown,
      flatItems,
      highlightedIndex,
      onEnter,
      setHighlightedIndex,
      scrollHighlightedIntoView,
      closeDropdown,
    ]
  );

  useEffect(() => {
    if (!isOpen) {
      setShouldRenderDropdown(false);
      setHighlightedIndex(null);
      return;
    }

    const timer = setTimeout(() => setShouldRenderDropdown(true), 0);
    return () => clearTimeout(timer);
  }, [isOpen, setHighlightedIndex]);

  useEffect(() => {
    if (shouldRenderDropdown && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [shouldRenderDropdown]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        closeDropdown();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, closeDropdown]);

  useEffect(() => {
    if (!shouldRenderDropdown || !onScrollNearEnd || !listRef.current) return;

    const handleScroll = () => {
      const element = listRef.current;
      if (!element) return;

      const { scrollTop, scrollHeight, clientHeight } = element;
      const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;
      if (scrollPercentage > scrollThreshold) {
        onScrollNearEnd();
      }
    };

    const element = listRef.current;
    element.addEventListener('scroll', handleScroll);
    return () => element.removeEventListener('scroll', handleScroll);
  }, [shouldRenderDropdown, onScrollNearEnd, scrollThreshold]);

  const dropdownPosition = dropdownAlign === 'right' ? 'right-0' : 'left-0';

  return (
    <div className={`relative ${className}`} ref={dropdownRef} aria-label={ariaLabel}>
      {trigger}

      {isOpen && (
        <div
          className={`absolute top-full ${dropdownPosition} w-80 mt-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg max-h-[70vh] overflow-hidden z-50 ${dropdownClassName}`}
        >
          {!shouldRenderDropdown ? (
            <div className="p-8 text-center text-zinc-500">Loading...</div>
          ) : (
            <>
              {tabs.length > 1 && (
                <div
                  className="flex flex-nowrap overflow-x-auto border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50"
                  onWheel={(e) => {
                    e.preventDefault();
                    e.currentTarget.scrollLeft += e.deltaY;
                  }}
                >
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => {
                        onTabChange(tab.id);
                        if (searchInputRef.current) searchInputRef.current.focus();
                      }}
                      className={`flex-1 px-3 py-2 text-xs font-medium text-center border-b-2 transition-colors ${
                        activeTab === tab.id
                          ? 'border-zinc-800 dark:border-zinc-200 text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-900'
                          : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <div className="flex items-center justify-center gap-1.5 truncate">
                        {tab.label}
                        {tab.hasSelected && (
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400 flex-shrink-0" />
                        )}
                      </div>
                      {showTabCounts && typeof tab.count === 'number' && (
                        <div className="text-xs opacity-75">({tab.count})</div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              <div className="p-2 border-b border-zinc-200 dark:border-zinc-800">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={searchPlaceholder}
                    className="w-full pl-10 pr-3 py-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600 text-sm"
                  />
                </div>
              </div>

                {extraHeader}

              <div
                ref={listRef}
                className={`overflow-y-auto ${listClassName}`}
                style={{ contentVisibility: 'auto' }}
                role="listbox"
              >
                {sections.map((section, sectionIndex) => {
                  const sectionOffset = sections
                    .slice(0, sectionIndex)
                    .reduce((acc, current) => acc + current.items.length, 0);

                  return (
                    <div key={section.id}>
                      {section.header}
                      {section.items.map((item, itemIndex) => {
                        const index = sectionOffset + itemIndex;
                        return renderItem(item, index, highlightedIndex === index);
                      })}
                    </div>
                  );
                })}

                {flatItems.length === 0 && emptyState}
              </div>

              {footer}
            </>
          )}
        </div>
      )}
    </div>
  );
}
