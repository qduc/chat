import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge needs to know about our custom theme keys so that, for example,
 * `rounded-card` correctly overrides `rounded-control` when a caller passes className.
 * Color tokens (bg-canvas, text-fg-muted, ...) are recognized automatically.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['control', 'card'],
      shadow: ['popover'],
    },
  },
});

type ClassValue = string | false | null | undefined;

/** Join class names, dropping falsy values, and resolve Tailwind conflicts (last wins). */
export function cn(...classes: ClassValue[]): string {
  return twMerge(classes.filter(Boolean).join(' '));
}
