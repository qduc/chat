import React from 'react';
import { ChevronDown } from 'lucide-react';
import { NativeSelect } from './Input';
import { cn } from '../../lib/cn';
import type { ReasoningEffortLevel, StoredReasoningEffort } from '../../lib/types';

export type { ReasoningEffortLevel, StoredReasoningEffort };
/** @deprecated Use ReasoningEffortLevel instead */
export type QualityLevel = ReasoningEffortLevel;

/**
 * A saved `minimal` is thinking off, so it sits on None. A saved `max` sits
 * on X-High, which is what the proxy sends. The stored value changes only
 * when the user picks a different option.
 */
function displayedEffort(value: StoredReasoningEffort): ReasoningEffortLevel {
  if (value === 'minimal') return 'none';
  if (value === 'max') return 'xhigh';
  return value;
}

interface QualitySliderProps {
  value: StoredReasoningEffort;
  onChange: (value: ReasoningEffortLevel) => void;
  ariaLabel?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  /** Short visible label shown before the value on wider screens. */
  label?: string;
  /** `field`: bordered select. `chip`: quiet inline control for toolbars. */
  variant?: 'field' | 'chip';
  className?: string;
}

const OPTIONS: { value: ReasoningEffortLevel; label: string }[] = [
  { value: 'unset', label: 'Default' },
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X-High' },
];

export function QualitySlider({
  value,
  onChange,
  ariaLabel,
  disabled,
  icon,
  label,
  variant = 'field',
  className,
}: QualitySliderProps) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value as ReasoningEffortLevel);
  };

  const current = displayedEffort(value);
  const options = OPTIONS.map((o) => (
    <option key={o.value} value={o.value}>
      {o.label}
    </option>
  ));

  if (variant === 'chip') {
    const currentLabel = OPTIONS.find((o) => o.value === current)?.label ?? current;
    // A native select laid over a quiet label: native keyboard, screen-reader and
    // touch-picker behavior, with the same look as the other toolbar chips.
    return (
      <div
        className={cn(
          'relative inline-flex h-8 shrink-0 items-center gap-1 rounded-control px-2 text-sm text-fg-muted transition-colors touch-target',
          'hover:bg-muted hover:text-fg has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-offset-2 has-[select:focus-visible]:outline-focus',
          disabled && 'opacity-50',
          className
        )}
      >
        {icon && (
          <span aria-hidden="true" className="flex size-4 items-center sm:hidden [&_svg]:size-4">
            {icon}
          </span>
        )}
        <span aria-hidden="true" className="whitespace-nowrap">
          {label && <span className="hidden sm:inline">{label}: </span>}
          <span className="text-fg">{currentLabel}</span>
        </span>
        <ChevronDown aria-hidden="true" className="size-4" />
        <select
          value={current}
          onChange={handleChange}
          disabled={disabled}
          aria-label={ariaLabel || 'Reasoning effort'}
          className="absolute inset-0 cursor-pointer appearance-none opacity-0 outline-none disabled:cursor-not-allowed"
        >
          {options}
        </select>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {icon && (
        <span aria-hidden="true" className="flex size-4 items-center text-fg-muted [&_svg]:size-4">
          {icon}
        </span>
      )}
      {label && <span className="hidden text-xs text-fg-muted sm:inline">{label}</span>}
      <NativeSelect
        controlSize="sm"
        value={current}
        onChange={handleChange}
        disabled={disabled}
        aria-label={ariaLabel || 'Reasoning effort'}
      >
        {options}
      </NativeSelect>
    </div>
  );
}

export default QualitySlider;
