import React from 'react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const base =
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium ' +
  'transition-colors focus-ring touch-target select-none ' +
  'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';

const variants: Record<ButtonVariant, string> = {
  // The single primary action in a view: neutral fill, never the accent.
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  // Secondary actions: outline.
  secondary: 'border border-line bg-surface text-fg hover:bg-muted',
  // Tertiary / toolbar actions.
  ghost: 'text-fg-muted hover:bg-muted hover:text-fg',
  // Confirming a destructive action.
  danger: 'bg-danger text-on-danger hover:bg-danger-hover',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3',
  md: 'h-9 px-4',
};

export function buttonClasses({
  variant = 'secondary',
  size = 'md',
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends React.ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return <button type={type} className={buttonClasses({ variant, size, className })} {...props} />;
}

export type IconButtonVariant = 'ghost' | 'secondary';

export interface IconButtonProps extends Omit<React.ComponentProps<'button'>, 'aria-label'> {
  /** Accessible name. Required because the button has no visible text. */
  label: string;
  variant?: IconButtonVariant;
  size?: ButtonSize;
}

const iconSizes: Record<ButtonSize, string> = {
  sm: 'size-8',
  md: 'size-9',
};

export function iconButtonClasses({
  variant = 'ghost',
  size = 'md',
  className,
}: {
  variant?: IconButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(base, variants[variant], iconSizes[size], 'p-0', className);
}

export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={iconButtonClasses({ variant, size, className })}
      {...props}
    />
  );
}

export default Button;
