import React, { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';

/** Pointer travel (px) under which a press counts as a click, not a drag. */
const CLICK_SLOP = 4;

interface PanelEdgeProps {
  /** Which edge of the parent panel the strip runs along. */
  side: 'left' | 'right';
  /** Direction the chevron points, i.e. where the panel will move. */
  direction: 'left' | 'right';
  /** Native tooltip text, e.g. "Collapse sidebar (Ctrl+\)". */
  hint: string;
  onToggle: () => void;
  /** Optional drag behaviour (resizing); a press that barely moves still toggles. */
  onDragStart?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  /** Keeps the edge lit while a drag is in progress. */
  active?: boolean;
  className?: string;
}

/**
 * A full-height click strip along a panel's inner border, so opening or
 * closing a sidebar doesn't need aiming at a small button. On hover the
 * border darkens and a chevron follows the pointer. Mouse-only affordance:
 * keyboard users have the toggle buttons and shortcuts, so it is aria-hidden.
 */
export function PanelEdge({
  side,
  direction,
  hint,
  onToggle,
  onDragStart,
  active = false,
  className,
}: PanelEdgeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const downX = useRef<number | null>(null);
  const Chevron = direction === 'left' ? ChevronLeft : ChevronRight;

  return (
    <div
      ref={ref}
      aria-hidden="true"
      title={hint}
      data-testid="panel-edge"
      data-active={active || undefined}
      className={cn(
        'group/edge absolute inset-y-0 z-40 hidden w-2 select-none md:block',
        onDragStart ? 'cursor-col-resize' : 'cursor-pointer',
        side === 'left' ? 'left-0' : 'right-0',
        className
      )}
      onPointerMove={(event) => {
        const box = ref.current?.getBoundingClientRect();
        if (box) ref.current?.style.setProperty('--edge-y', `${event.clientY - box.top}px`);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        downX.current = event.clientX;
        onDragStart?.(event);
      }}
      onClick={(event) => {
        const start = downX.current;
        downX.current = null;
        if (start !== null && Math.abs(event.clientX - start) > CLICK_SLOP) return;
        onToggle();
      }}
    >
      <span
        className={cn(
          'absolute inset-y-0 w-px transition-colors group-hover/edge:bg-line-strong group-data-active/edge:bg-accent',
          side === 'left' ? 'left-0' : 'right-0'
        )}
      />
      <span
        className={cn(
          'pointer-events-none absolute top-(--edge-y,50%) flex size-6 -translate-y-1/2 items-center justify-center',
          'rounded-full border border-line-strong bg-surface text-fg-muted opacity-0 transition-opacity',
          'group-hover/edge:opacity-100 group-data-active/edge:opacity-0 [&_svg]:size-4',
          side === 'left' ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2'
        )}
      >
        <Chevron />
      </span>
    </div>
  );
}
