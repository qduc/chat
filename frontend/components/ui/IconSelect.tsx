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
  FloatingFocusManager
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
  className = ''
}: IconSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find(o => o.value === value);

  const { refs, floatingStyles, context, x } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    strategy: 'fixed',
    middleware: [
      offset(4),
      flip(),
      shift({ padding: 8 })
    ],
    whileElementsMounted: autoUpdate
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'listbox' });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    role
  ]);


  const buttonClass = `rounded-lg px-3 py-1.5 text-sm bg-transparent hover:bg-slate-100 dark:hover:bg-neutral-800 border-none text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 cursor-pointer flex items-center justify-between gap-2 min-w-0 ${className}`;


  return (
    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
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
              width: 'max-content',
              maxHeight: '240px',
              overflowY: 'auto',
              visibility: isOpen && x == null ? 'hidden' : undefined
            }}
            className="py-1 bg-white dark:bg-neutral-900 rounded-lg shadow-lg backdrop-blur-lg z-[9999]"
            {...getFloatingProps()}
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors duration-150 whitespace-nowrap ${
                  option.value === value
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
                style={{
                  background: option.value === value ? undefined : 'transparent',
                  border: 'none'
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
