'use client';
import React from 'react';
import { ChevronDown } from 'lucide-react';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useClick,
  useDismiss,
  useRole,
  useInteractions,
  FloatingFocusManager,
} from '@floating-ui/react';

export type Option = { value: string; label: string };
export type Group = { id: string; label: string; options: Option[] };

interface TabbedSelectProps {
  ariaLabel?: string;
  value: string;
  onChange: (v: string) => void;
  groups: Group[];
  className?: string;
}

export default function TabbedSelect({
  ariaLabel,
  value,
  onChange,
  groups,
  className = '',
}: TabbedSelectProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const currentGroupIndex = React.useMemo(() => {
    const idx = groups.findIndex((g) => g.options.some((o) => o.value === value));
    return idx >= 0 ? idx : 0;
  }, [groups, value]);
  const [activeIndex, setActiveIndex] = React.useState(currentGroupIndex);

  React.useEffect(() => setActiveIndex(currentGroupIndex), [currentGroupIndex]);

  const selectedOption = React.useMemo(() => {
    for (const g of groups) {
      const found = g.options.find((o) => o.value === value);
      if (found) return found;
    }
    return undefined;
  }, [groups, value]);

  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    strategy: 'fixed',
    transform: false,
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: (reference, floating, update) =>
      autoUpdate(reference, floating, update, { animationFrame: true }),
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'listbox' });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

  const buttonClass = `rounded-lg px-3 py-1.5 text-sm bg-transparent hover:bg-slate-100 dark:hover:bg-neutral-800 border-none text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 cursor-pointer flex items-center justify-between gap-2 min-w-0 ${className}`;

  return (
    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
      <button
        ref={refs.setReference}
        aria-label={ariaLabel}
        type="button"
        className={buttonClass}
        {...getReferenceProps()}
      >
        <span className="truncate">{selectedOption?.label || 'Select model...'}</span>
        <ChevronDown
          className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <FloatingFocusManager context={context} modal={false}>
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              minWidth: '220px',
              maxHeight: '300px',
              overflow: 'hidden',
              visibility: isPositioned ? 'visible' : 'hidden',
            }}
            className={`bg-white dark:bg-neutral-900 rounded-lg shadow-lg backdrop-blur-lg z-[9999] ${isPositioned ? 'transition-opacity duration-150' : 'transition-none'}`}
            {...getFloatingProps()}
          >
            {/* Tabs */}
            <div className="flex border-b border-slate-200 dark:border-slate-700">
              {groups.map((g, i) => (
                <button
                  key={g.id}
                  type="button"
                  className={`px-3 py-2 text-xs truncate ${i === activeIndex ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-500' : 'text-slate-600 dark:text-slate-400'}`}
                  onClick={() => setActiveIndex(i)}
                >
                  {g.label}
                </button>
              ))}
            </div>

            {/* Options */}
            <div className="max-h-60 overflow-y-auto">
              {groups[activeIndex]?.options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={opt.value === value}
                  className={`w-full block text-left px-3 py-2 text-sm cursor-pointer hover:bg-slate-100 dark:hover:bg-neutral-800 hover:text-slate-900 dark:hover:text-slate-100 transition-all duration-200 ${
                    opt.value === value
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
              {(!groups[activeIndex] || groups[activeIndex].options.length === 0) && (
                <div className="px-3 py-2 text-xs text-slate-500">No models</div>
              )}
            </div>
          </div>
        </FloatingFocusManager>
      )}
    </div>
  );
}
