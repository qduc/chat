import React from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  label?: React.ReactNode;
  className?: string;
}

export function Toggle({
  checked,
  onChange,
  ariaLabel,
  disabled,
  icon,
  label,
  className = '',
}: ToggleProps) {
  return (
    <div
      className={`flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 select-none ${className}`}
    >
      {icon && <span className="w-4 h-4 flex items-center justify-center">{icon}</span>}

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`
          relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent
          transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2
          ${
            checked
              ? 'bg-emerald-600 focus:ring-emerald-500'
              : 'bg-slate-200 dark:bg-slate-700 focus:ring-slate-500'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-sm'}
        `}
      >
        <span
          className={`
            pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0
            transition duration-200 ease-in-out
            ${checked ? 'translate-x-5' : 'translate-x-0'}
            ${disabled ? 'opacity-75' : ''}
          `}
        />
      </button>

      {label && (
        <span
          className={`text-sm ${disabled ? 'opacity-50 text-slate-400' : 'text-slate-700 dark:text-slate-300'}`}
        >
          {label}
        </span>
      )}
    </div>
  );
}

export default Toggle;
