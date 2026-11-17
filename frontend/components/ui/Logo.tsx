import React from 'react';
import { cn } from '../../lib/cn';

/**
 * The ChatForge mark, rendered as a mask filled with the foreground token so it
 * stays visible in both themes.
 */
export function Logo({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('logo-mark inline-block size-8 shrink-0 bg-fg', className)}
    />
  );
}

export default Logo;
