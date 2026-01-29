import React, { useEffect } from 'react';

export type ReasoningEffortLevel = 'unset' | 'minimal' | 'low' | 'medium' | 'high';
/** @deprecated Use ReasoningEffortLevel instead */
export type QualityLevel = ReasoningEffortLevel;

interface QualitySliderProps {
  value: ReasoningEffortLevel;
  onChange: (value: ReasoningEffortLevel) => void;
  ariaLabel?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  className?: string;
  model?: string;
}

export function QualitySlider({
  value,
  onChange,
  ariaLabel,
  disabled,
  icon,
  className = '',
  model = '',
}: QualitySliderProps) {
  // Check if model supports 'minimal' (gpt-5* or openai/gpt-5*)
  const supportsMinimal =
    (model.startsWith('gpt-5') || model.startsWith('openai/gpt-5')) && !model.includes('gpt-5.1');

  useEffect(() => {
    if (value === 'minimal' && !supportsMinimal) {
      onChange('unset');
    }
  }, [value, model, supportsMinimal, onChange]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value as ReasoningEffortLevel);
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {icon && (
        <span className="w-4 h-4 flex items-center text-slate-600 dark:text-slate-400">{icon}</span>
      )}

      <select
        value={value}
        onChange={handleChange}
        disabled={disabled}
        aria-label={ariaLabel || 'Reasoning effort'}
        className="text-xs px-2 py-1 bg-transparent border border-slate-200 dark:border-neutral-700 rounded-md
                   text-slate-800 dark:text-slate-200 cursor-pointer
                   hover:bg-slate-50 dark:hover:bg-neutral-800
                   focus:outline-none focus:ring-2 focus:ring-slate-400 dark:focus:ring-neutral-600
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <option value="unset">Unset</option>
        {supportsMinimal && <option value="minimal">Minimal</option>}
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
    </div>
  );
}

export default QualitySlider;
