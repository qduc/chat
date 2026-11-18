import React from 'react';
import { Input as BaseInput } from '@base-ui/react/input';
import { Field as BaseField } from '@base-ui/react/field';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';

/** Shared look for text-entry controls. */
export const controlClasses =
  'w-full rounded-control border border-line-control bg-surface text-sm text-fg ' +
  'hover:border-line-strong focus-visible:border-line-strong ' +
  'placeholder:text-fg-subtle transition-colors focus-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-50 ' +
  'aria-invalid:border-danger data-invalid:border-danger';

export type InputProps = Omit<React.ComponentProps<typeof BaseInput>, 'className'> & {
  className?: string;
};

/** Text input. Inside a `Field`, it is labelled and described automatically. */
export function Input({ className, ...props }: InputProps) {
  return (
    <BaseInput className={cn(controlClasses, 'h-9 px-3 touch-target', className)} {...props} />
  );
}

export type TextareaProps = React.ComponentProps<'textarea'>;

/** Multi-line text input. Inside a `Field`, it is labelled and described automatically. */
export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <BaseField.Control
      render={(controlProps) => (
        <textarea
          {...(controlProps as React.ComponentProps<'textarea'>)}
          {...props}
          className={cn(controlClasses, 'px-3 py-2', className)}
        />
      )}
    />
  );
}

export interface NativeSelectProps extends React.ComponentProps<'select'> {
  size?: never;
  controlSize?: 'sm' | 'md';
}

/**
 * Styled native <select>. Native selects are fully keyboard and screen-reader
 * accessible and use the platform picker on touch devices.
 */
export function NativeSelect({
  className,
  controlSize = 'md',
  children,
  ...props
}: NativeSelectProps) {
  return (
    <span className={cn('relative inline-flex', className)}>
      <select
        className={cn(
          controlClasses,
          'appearance-none pr-8 pl-3 touch-target cursor-pointer',
          controlSize === 'sm' ? 'h-8 text-xs' : 'h-9'
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-fg-muted"
      />
    </span>
  );
}

export interface FieldProps {
  label: React.ReactNode;
  /** Optional marker shown after the label, e.g. "(Optional)". */
  hint?: React.ReactNode;
  description?: React.ReactNode;
  /** When set, shown as an error and the control is marked invalid. */
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/**
 * Label + control + description/error, wired up with the right ARIA relationships.
 * The control must be an `Input`, `Textarea`, or other Base UI Field control.
 */
export function Field({ label, hint, description, error, className, children }: FieldProps) {
  return (
    <BaseField.Root invalid={Boolean(error)} className={cn('flex flex-col gap-2', className)}>
      <BaseField.Label className="text-sm font-medium text-fg">
        {label}
        {hint ? <span className="ml-2 font-normal text-fg-subtle">{hint}</span> : null}
      </BaseField.Label>
      {children}
      {description && !error ? (
        <BaseField.Description className="text-xs text-fg-muted">
          {description}
        </BaseField.Description>
      ) : null}
      {error ? (
        <BaseField.Error match className="text-xs text-danger">
          {error}
        </BaseField.Error>
      ) : null}
    </BaseField.Root>
  );
}

export default Input;
