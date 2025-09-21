import React from 'react';

export type QualityLevel = 'quick' | 'balanced' | 'thorough';

interface QualitySliderProps {
  value: QualityLevel;
  onChange: (value: QualityLevel) => void;
  ariaLabel?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  className?: string;
}

const qualityConfig: Record<QualityLevel, { label: string; description: string; reasoningEffort: string; verbosity: string }> = {
  quick: {
    label: 'Quick',
    description: 'Fast responses with minimal reasoning',
    reasoningEffort: 'low',
    verbosity: 'medium'
  },
  balanced: {
    label: 'Balanced',
    description: 'Good balance of speed and thoughtfulness',
    reasoningEffort: 'medium',
    verbosity: 'medium'
  },
  thorough: {
    label: 'Thorough',
    description: 'Deep reasoning with comprehensive responses',
    reasoningEffort: 'high',
    verbosity: 'medium'
  }
};
export function QualitySlider({ value, onChange, ariaLabel, disabled, icon, className = '' }: QualitySliderProps) {
  const levels: QualityLevel[] = ['quick', 'balanced', 'thorough'];
  const currentIndex = levels.indexOf(value);
  const config = qualityConfig[value];

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newLevel = levels[parseInt(e.target.value)];
    onChange(newLevel);
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {icon && <span className="w-4 h-4 flex items-center text-slate-600 dark:text-slate-400">{icon}</span>}

      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap w-14 text-left">
          {config.label}
        </span>
        <input
          type="range"
          min="0"
          max="2"
          step="1"
          value={currentIndex}
          onChange={handleSliderChange}
          disabled={disabled}
          aria-label={ariaLabel || 'Quality level'}
          className="w-16 h-2 bg-slate-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer
                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                   [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-slate-600 dark:[&::-webkit-slider-thumb]:bg-slate-400
                   [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white
                   [&::-webkit-slider-thumb]:shadow-md hover:[&::-webkit-slider-thumb]:bg-slate-700 dark:hover:[&::-webkit-slider-thumb]:bg-slate-300
                   [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
                   [&::-moz-range-thumb]:bg-slate-600 dark:[&::-moz-range-thumb]:bg-slate-400 [&::-moz-range-thumb]:cursor-pointer
                   [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md
                   disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}

export default QualitySlider;
