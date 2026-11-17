'use client';
import React from 'react';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { cn } from '../../lib/cn';

/** Shared look for floating panels (menus, popovers, listboxes). */
export const floatingPanelClasses =
  'rounded-card border border-line bg-surface text-fg shadow-popover outline-none ' +
  'origin-(--transform-origin) transition-opacity data-starting-style:opacity-0 data-ending-style:opacity-0';

/** Shared look for a row inside a floating panel. */
export const floatingItemClasses =
  'flex w-full cursor-default items-center gap-2 rounded-control px-3 py-2 text-left text-sm text-fg outline-none select-none touch-target ' +
  'data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted';

export const Menu = BaseMenu.Root;

export type MenuTriggerProps = React.ComponentProps<typeof BaseMenu.Trigger>;

/** The element that opens the menu. Use `render` to supply your own styled button. */
export const MenuTrigger = BaseMenu.Trigger;

export interface MenuContentProps {
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  className?: string;
  children: React.ReactNode;
}

export function MenuContent({
  side = 'bottom',
  align = 'end',
  className,
  children,
}: MenuContentProps) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner side={side} align={align} sideOffset={8} className="z-50 outline-none">
        <BaseMenu.Popup className={cn(floatingPanelClasses, 'min-w-48 p-1', className)}>
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export interface MenuItemProps {
  onClick?: () => void;
  disabled?: boolean;
  /** Use for destructive items such as "Delete". */
  tone?: 'default' | 'danger';
  className?: string;
  children: React.ReactNode;
}

export function MenuItem({
  onClick,
  disabled,
  tone = 'default',
  className,
  children,
}: MenuItemProps) {
  return (
    <BaseMenu.Item
      onClick={onClick}
      disabled={disabled}
      className={cn(
        floatingItemClasses,
        tone === 'danger' && 'text-danger [&_svg]:text-danger',
        className
      )}
    >
      {children}
    </BaseMenu.Item>
  );
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="-mx-1 my-1 h-px bg-line" />;
}

export function MenuGroup({
  label,
  children,
}: {
  label?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <BaseMenu.Group>
      {label ? (
        <BaseMenu.GroupLabel className="px-3 py-2 text-xs text-fg-subtle">
          {label}
        </BaseMenu.GroupLabel>
      ) : null}
      {children}
    </BaseMenu.Group>
  );
}
