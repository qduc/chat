'use client';
import React from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { iconButtonClasses } from './Button';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const sizes: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-none h-full',
};

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

/** Controlled modal dialog. Traps focus while open and restores it on close. */
export function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      {children}
    </BaseDialog.Root>
  );
}

export interface DialogContentProps {
  title: React.ReactNode;
  /** Optional supporting text under the title. */
  description?: React.ReactNode;
  size?: DialogSize;
  /** Footer row, typically one primary Button and secondary/ghost Buttons. */
  footer?: React.ReactNode;
  /** Accessible name of the close button. */
  closeLabel?: string;
  /** Element to focus when the dialog opens. Defaults to the first focusable element. */
  initialFocus?: React.RefObject<HTMLElement | null>;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
}

export function DialogContent({
  title,
  description,
  size = 'md',
  footer,
  closeLabel = 'Close',
  initialFocus,
  className,
  bodyClassName,
  children,
}: DialogContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-overlay transition-opacity data-starting-style:opacity-0 data-ending-style:opacity-0" />
      <BaseDialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <BaseDialog.Popup
          initialFocus={initialFocus}
          className={cn(
            'flex max-h-full w-full flex-col overflow-hidden rounded-card border border-line bg-surface text-fg shadow-popover outline-none',
            'transition-opacity data-starting-style:opacity-0 data-ending-style:opacity-0',
            sizes[size],
            className
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line py-3 pr-3 pl-6">
            <div className="flex min-w-0 flex-col gap-1 py-1">
              <BaseDialog.Title className="truncate text-base font-medium text-fg">
                {title}
              </BaseDialog.Title>
              {description ? (
                <BaseDialog.Description className="text-sm text-fg-muted">
                  {description}
                </BaseDialog.Description>
              ) : null}
            </div>
            <BaseDialog.Close aria-label={closeLabel} className={iconButtonClasses({ size: 'sm' })}>
              <X />
            </BaseDialog.Close>
          </div>
          <div className={cn('min-h-0 flex-1 overflow-y-auto p-6', bodyClassName)}>{children}</div>
          {footer ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4">
              {footer}
            </div>
          ) : null}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  );
}

export default Dialog;
