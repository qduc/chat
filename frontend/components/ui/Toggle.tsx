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

export function Toggle({ checked, onChange, ariaLabel, disabled, icon, label, className = '' }: ToggleProps) {
  return (
    <div className={`flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 select-none ${className}`}>
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
          ${checked 
            ? 'bg-emerald-600 focus:ring-emerald-500' 
            : 'bg-slate-200 dark:bg-slate-700 focus:ring-slate-500'
          }
          ${disabled 
            ? 'opacity-50 cursor-not-allowed' 
            : 'hover:shadow-sm'
          }
        `}
      >
        <span
          className={`
            pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 
            transition duration-200 ease-in-out
            ${checked ? 'translate-x-5' : 'translate-x-0'}
            ${disabled ? 'opacity-75' : ''}
          `}
        >
          {/* Optional check/cross icons inside the switch */}
          <span className={`
            absolute inset-0 flex items-center justify-center transition-opacity duration-100
            ${checked ? 'opacity-100' : 'opacity-0'}
          `}>
            <svg className="h-3 w-3 text-emerald-600" fill="currentColor" viewBox="0 0 12 12">
              <path d="M3.707 5.293a1 1 0 00-1.414 1.414l1.414-1.414zM5 8l-.707.707a1 1 0 001.414 0L5 8zm4.707-3.293a1 1 0 00-1.414-1.414l1.414 1.414zm-7.414 2L5 9.414 8.707 5.707l-1.414-1.414L5 6.586 3.707 5.293z" />
            </svg>
          </span>
          <span className={`
            absolute inset-0 flex items-center justify-center transition-opacity duration-100
            ${!checked ? 'opacity-100' : 'opacity-0'}
          `}>
            <svg className="h-3 w-3 text-slate-400" fill="currentColor" viewBox="0 0 12 12">
              <path d="M4 8l2-2m0 0l2-2M6 6L4 4m2 2l2 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
          </span>
        </span>
      </button>
      
      {label && (
        <span className={`text-sm ${disabled ? 'opacity-50 text-slate-400' : 'text-slate-700 dark:text-slate-300'}`}>
          {label}
        </span>
      )}
    </div>
  );
}

export default Toggle;
