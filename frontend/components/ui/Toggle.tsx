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
    <label className={`flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 select-none ${className}`} aria-disabled={disabled}>
      {icon ? <span className="w-5 h-5 flex items-center">{icon}</span> : null}
      <input
        type="checkbox"
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-slate-300 dark:border-neutral-700 text-blue-600 focus:ring-blue-500"
      />
      {label ? <span className={disabled ? 'opacity-50' : ''}>{label}</span> : null}
    </label>
  );
}

export default Toggle;
