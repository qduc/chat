'use client';
import React from 'react';
import { Switch } from '@base-ui/react/switch';
import { cn } from '../../lib/cn';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  label?: React.ReactNode;
  className?: string;
}

/** On/off switch built on Base UI Switch. */
export function Toggle({
  checked,
  onChange,
  ariaLabel,
  disabled,
  icon,
  label,
  className,
}: ToggleProps) {
  const control = (
    <Switch.Root
      checked={checked}
      onCheckedChange={(next) => onChange(next)}
      disabled={disabled}
      aria-label={label ? undefined : ariaLabel}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-emphasis p-0.5 transition-colors focus-ring',
        'data-checked:border-accent data-checked:bg-accent',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50',
        // Enlarge the hit area to 44px on touch without changing the visual size.
        'pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5'
      )}
    >
      <Switch.Thumb className="size-4 rounded-full bg-fg-muted transition-[translate,background-color] data-checked:translate-x-4.5 data-checked:bg-on-accent" />
    </Switch.Root>
  );

  if (!label && !icon) {
    return <span className={cn('inline-flex', className)}>{control}</span>;
  }

  return (
    <label
      className={cn(
        'inline-flex items-center gap-2 text-sm text-fg-muted select-none',
        disabled && 'opacity-50',
        className
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="flex size-4 items-center justify-center">
          {icon}
        </span>
      ) : null}
      {control}
      {label ? <span className="text-fg">{label}</span> : null}
    </label>
  );
}

export default Toggle;
