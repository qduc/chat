'use client';
import React from 'react';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { cn } from '../../lib/cn';

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}

export function Tabs({ value, onValueChange, className, children }: TabsProps) {
  return (
    <BaseTabs.Root
      value={value}
      onValueChange={(next) => onValueChange(String(next))}
      className={cn('flex flex-col gap-6', className)}
    >
      {children}
    </BaseTabs.Root>
  );
}

export function TabsList({
  ariaLabel,
  className,
  children,
}: {
  ariaLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <BaseTabs.List
      aria-label={ariaLabel}
      className={cn('relative flex shrink-0 gap-4 overflow-x-auto border-b border-line', className)}
    >
      {children}
      {/* Active-state underline: one of the few places the accent appears. */}
      <BaseTabs.Indicator className="absolute bottom-0 left-0 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) bg-accent transition-[translate,width]" />
    </BaseTabs.List>
  );
}

export function TabsTab({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <BaseTabs.Tab
      value={value}
      className={cn(
        'flex h-10 shrink-0 items-center gap-2 px-1 text-sm whitespace-nowrap text-fg-muted transition-colors outline-none select-none touch-target',
        'hover:text-fg data-active:text-fg focus-ring-inset [&_svg]:size-4',
        className
      )}
    >
      {children}
    </BaseTabs.Tab>
  );
}

export function TabsPanel({
  value,
  className,
  children,
  keepMounted,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
  /** Keep the panel in the DOM while hidden (preserves state). */
  keepMounted?: boolean;
}) {
  return (
    <BaseTabs.Panel
      value={value}
      keepMounted={keepMounted}
      className={cn('outline-none focus-ring', className)}
    >
      {children}
    </BaseTabs.Panel>
  );
}
