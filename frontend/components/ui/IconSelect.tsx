import React, { useState } from 'react';
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

type Option = { value: string; label: string };

interface IconSelectProps {
  id?: string;
  ariaLabel?: string;
  icon?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  className?: string;
}

export function IconSelect({
  id,
  ariaLabel,
  icon,
  value,
  onChange,
  options,
  className = '',
}: IconSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((o) => o.value === value);

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

  const buttonClass = `rounded-lg px-3 py-1.5 text-sm bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800 border-none text-zinc-700 dark:text-zinc-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 cursor-pointer flex items-center justify-between gap-2 min-w-0 ${className}`;

  return (
    <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
      {icon ? <span className="w-5 h-5 flex items-center">{icon}</span> : null}
      <button
        ref={refs.setReference}
        id={id}
        aria-label={ariaLabel}
        type="button"
        className={buttonClass}
        {...getReferenceProps()}
      >
        <span className="truncate">{selectedOption?.label || 'Select...'}</span>
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
              minWidth: '120px',
              maxHeight: '240px',
              overflowY: 'auto',
              visibility: isPositioned ? 'visible' : 'hidden',
            }}
            className={`py-1 bg-white dark:bg-zinc-900 rounded-lg shadow-lg backdrop-blur-lg z-[9999] border border-zinc-200 dark:border-zinc-800 ${isPositioned ? 'transition-opacity duration-150' : 'transition-none'}`}
            {...getFloatingProps()}
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`w-full block text-left px-3 py-2 text-sm cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all duration-200 ${
                  option.value === value
                  ? 'bg-zinc-100 dark:bg-zinc-800 font-medium text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-700 dark:text-zinc-300'
                }`}
                style={{
                  border: 'none',
                }}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </FloatingFocusManager>
      )}
    </div>
  );
}

export default IconSelect;
