import React from 'react';
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
  /** Short visible label shown before the select on wider screens. */
  label?: string;
  className?: string;
}

export function QualitySlider({
  value,
  onChange,
  ariaLabel,
  disabled,
  icon,
  label,
  className,
}: QualitySliderProps) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value as ReasoningEffortLevel);
  };

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
        value={displayedEffort(value)}
        onChange={handleChange}
        disabled={disabled}
        aria-label={ariaLabel || 'Reasoning effort'}
      >
        <option value="unset">Unset</option>
        <option value="none">None</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="xhigh">X-High</option>
      </NativeSelect>
    </div>
  );
}

export default QualitySlider;
