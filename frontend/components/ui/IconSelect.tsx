import React from 'react';

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
  const base = 'rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200';
  return (
    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
      {icon ? <span className="w-5 h-5 flex items-center">{icon}</span> : null}
      <select
        id={id}
        aria-label={ariaLabel}
        className={`${base} ${className}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default IconSelect;
