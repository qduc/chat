'use client';
import React from 'react';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { cn } from '../../lib/cn';
import { floatingPanelClasses } from './Menu';

export const Popover = BasePopover.Root;

/** The element that opens the popover. Use `render` to supply your own styled button. */
export const PopoverTrigger = BasePopover.Trigger;

export const PopoverClose = BasePopover.Close;

export interface PopoverContentProps {
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  /** Accessible name for the popup when it has no visible title. */
  ariaLabel?: string;
  /** Element to focus when the popover opens. */
  initialFocus?: React.RefObject<HTMLElement | null>;
  className?: string;
  children: React.ReactNode;
}

export function PopoverContent({
  side = 'bottom',
  align = 'start',
  ariaLabel,
  initialFocus,
  className,
  children,
}: PopoverContentProps) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        side={side}
        align={align}
        sideOffset={8}
        collisionPadding={8}
        className="z-50 outline-none"
      >
        <BasePopover.Popup
          aria-label={ariaLabel}
          initialFocus={initialFocus}
          className={cn(
            floatingPanelClasses,
            'max-h-(--available-height) max-w-(--available-width)',
            className
          )}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}
