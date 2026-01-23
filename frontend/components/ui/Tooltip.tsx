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
  useTransitionStyles,
} from '@floating-ui/react';
import type { Placement } from '@floating-ui/react';
import type { ReactNode } from 'react';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  delay?: number;
  placement?: Placement;
  disabled?: boolean;
  className?: string;
}

export default function Tooltip({
  content,
  children,
  delay = 400,
  placement = 'top',
  disabled = false,
  className,
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

  const { isMounted, styles } = useTransitionStyles(context, {
    duration: 200,
    initial: { opacity: 0, transform: 'scale(0.95) translateY(2px)' },
    open: { opacity: 1, transform: 'scale(1) translateY(0)' },
    close: { opacity: 0, transform: 'scale(0.95) translateY(2px)' },
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
    const base = 'fill-white dark:fill-zinc-900';
    const side = resolvedPlacement.split('-')[0];
    if (side === 'bottom') return `${base} -top-1 rotate-180`;
    if (side === 'left') return `${base} -right-1 rotate-90`;
    if (side === 'right') return `${base} -left-1 -rotate-90`;
    return `${base} -bottom-1`;
  }, [resolvedPlacement]);

  return (
    <>
      <div ref={refs.setReference} className={className ?? 'inline-flex'} {...getReferenceProps()}>
        {children}
      </div>
      {isMounted && content && !disabled && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-[9999] outline-none"
            {...getFloatingProps()}
          >
            <div
              style={styles}
              className="pointer-events-none rounded-lg bg-white/90 px-2.5 py-1.5 text-xs font-medium text-zinc-900 shadow-xl shadow-zinc-900/10 backdrop-blur-xl border border-white/20 ring-1 ring-zinc-200/50 max-w-[12rem] sm:max-w-[16rem] md:max-w-[20rem] lg:max-w-[24rem] tracking-tight dark:bg-zinc-900/90 dark:text-zinc-100 dark:ring-white/10 dark:border-white/5 dark:shadow-black/40"
            >
              {/* allow wrapping for long content and constrain width responsively */}
              <span className="break-words whitespace-normal">{content}</span>
              <svg
                ref={arrowRef}
                className={`absolute h-2 w-2 ${arrowPlacementClass}`}
                viewBox="0 0 8 8"
                style={{
                  left: middlewareData.arrow?.x != null ? `${middlewareData.arrow.x}px` : '',
                  top: middlewareData.arrow?.y != null ? `${middlewareData.arrow.y}px` : '',
                }}
              >
                <path d="M4 0L8 8H0L4 0Z" />
              </svg>
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
