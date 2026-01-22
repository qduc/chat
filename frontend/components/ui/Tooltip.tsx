'use client';

import { useMemo, useRef, useState } from 'react';
import {
  FloatingPortal,
  arrow,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import type { Placement } from '@floating-ui/react';
import type { ReactNode } from 'react';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  delay?: number;
  placement?: Placement;
  disabled?: boolean;
}

export default function Tooltip({
  content,
  children,
  delay = 400,
  placement = 'top',
  disabled = false,
}: TooltipProps) {
  const arrowRef = useRef<SVGSVGElement | null>(null);
  const [open, setOpen] = useState(false);

  const middleware = useMemo(
    () => [offset(8), flip({ padding: 8 }), shift({ padding: 8 }), arrow({ element: arrowRef })],
    []
  );

  // Force close when disabled
  if (disabled && open) {
    setOpen(false);
  }

  const {
    refs,
    floatingStyles,
    context,
    placement: resolvedPlacement,
    middlewareData,
  } = useFloating({
    open,
    onOpenChange: setOpen,
    middleware,
    placement,
  });

  const hover = useHover(context, {
    delay: { open: delay, close: 80 },
    move: false,
    enabled: !disabled,
  });
  const focus = useFocus(context, { enabled: !disabled });
  const role = useRole(context, { role: 'tooltip' });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, role, dismiss]);

  const arrowPlacementClass = useMemo(() => {
    const base = 'fill-zinc-800 dark:fill-zinc-100';
    const side = resolvedPlacement.split('-')[0];
    if (side === 'bottom') return `${base} -top-1 rotate-180`;
    if (side === 'left') return `${base} -right-1 rotate-90`;
    if (side === 'right') return `${base} -left-1 -rotate-90`;
    return `${base} -bottom-1`;
  }, [resolvedPlacement]);

  return (
    <>
      <div ref={refs.setReference} className="inline-flex" {...getReferenceProps()}>
        {children}
      </div>
      {open && content && !disabled && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            {...getFloatingProps()}
            style={floatingStyles}
            className="pointer-events-none z-[9999] rounded-lg bg-zinc-900/95 px-2.5 py-1.5 text-xs font-medium text-zinc-50 shadow-2xl shadow-black/20 outline-none transition-opacity duration-100 backdrop-blur-md border border-zinc-800/60 max-w-[12rem] sm:max-w-[16rem] md:max-w-[20rem] lg:max-w-[24rem] tracking-tight dark:bg-zinc-50/95 dark:text-zinc-900 dark:border-zinc-200/80 dark:shadow-black/10"
          >
            {/* allow wrapping for long content and constrain width responsively */}
            <span className="pointer-events-none break-words whitespace-normal">{content}</span>
            <svg
              ref={arrowRef}
              className={`pointer-events-none absolute h-2 w-2 ${arrowPlacementClass}`}
              viewBox="0 0 8 8"
              style={{
                left: middlewareData.arrow?.x != null ? `${middlewareData.arrow.x}px` : '',
                top: middlewareData.arrow?.y != null ? `${middlewareData.arrow.y}px` : '',
              }}
            >
              <path d="M4 0L8 8H0L4 0Z" />
            </svg>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
