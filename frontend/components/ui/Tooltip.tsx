'use client';

import React from 'react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { cn } from '../../lib/cn';

type Side = 'top' | 'bottom' | 'left' | 'right';
type Align = 'start' | 'center' | 'end';
export type TooltipPlacement = Side | `${Side}-${'start' | 'end'}`;

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  /** Open delay in ms. */
  delay?: number;
  placement?: TooltipPlacement;
  disabled?: boolean;
  /** Classes for the wrapper element around `children`. */
  className?: string;
}

function parsePlacement(placement: TooltipPlacement): { side: Side; align: Align } {
  const [side, align] = placement.split('-') as [Side, 'start' | 'end' | undefined];
  return { side, align: align ?? 'center' };
}

/**
 * Supplementary hover/focus hint. Not shown on touch devices, so never put
 * essential information in a tooltip.
 */
export default function Tooltip({
  content,
  children,
  delay = 400,
  placement = 'top',
  disabled = false,
  className,
}: TooltipProps) {
  const { side, align } = parsePlacement(placement);
  const isDisabled = disabled || !content;

  return (
    <BaseTooltip.Root disabled={isDisabled}>
      <BaseTooltip.Trigger
        delay={delay}
        closeDelay={80}
        render={<div className={className ?? 'inline-flex'} />}
      >
        {children}
      </BaseTooltip.Trigger>
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={8}
          className="z-50"
        >
          <BaseTooltip.Popup
            className={cn(
              'max-w-64 rounded-control bg-primary px-2 py-1 text-xs text-on-primary break-words',
              'transition-opacity data-starting-style:opacity-0 data-ending-style:opacity-0'
            )}
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
