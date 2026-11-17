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
  /**
   * Adds a close button that stays visually hidden until focused. Base UI only traps
   * focus in a `modal="trap-focus"` popover when a close part is rendered, and it gives
   * touch screen-reader users a way out. Omit if the content renders its own PopoverClose.
   */
  hiddenCloseLabel?: string;
  className?: string;
  children: React.ReactNode;
}

export function PopoverContent({
  side = 'bottom',
  align = 'start',
  ariaLabel,
  initialFocus,
  hiddenCloseLabel,
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
          {hiddenCloseLabel ? (
            <BasePopover.Close className="sr-only focus-visible:not-sr-only focus-visible:block focus-visible:w-full focus-visible:rounded-control focus-visible:px-3 focus-visible:py-2 focus-visible:text-left focus-visible:text-sm focus-visible:text-fg-muted focus-ring-inset">
              {hiddenCloseLabel}
            </BasePopover.Close>
          ) : null}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}
