# Design System

ChatForge's UI uses semantic design tokens, Tailwind CSS v4, and thin wrappers over [Base UI](https://base-ui.com) primitives. The look is restrained: neutral surfaces, one accent, hierarchy from type size and contrast, hairline borders, and flat surfaces.

- Tokens: `frontend/app/tokens.css`. This is the only file allowed to contain raw colors.
- Tailwind mapping and global styles: `frontend/app/globals.css`
- Components: `frontend/components/ui/`
- Checks: `npm run lint:design` (design lint) and `npm run check:contrast` (WCAG AA for all token pairs)

## Tokens → Tailwind classes

| Purpose | Class |
| --- | --- |
| App background | `bg-canvas` |
| Sidebars, recessed areas | `bg-canvas-subtle` |
| Cards, popovers, inputs | `bg-surface` |
| Hover fill, code blocks, chips | `bg-muted` |
| Selected or pressed neutral | `bg-emphasis` |
| Primary text | `text-fg` |
| Secondary text | `text-fg-muted` |
| Tertiary text, metadata, placeholders | `text-fg-subtle` |
| Hairline divider or card edge | `border-line` / `divide-line` / `bg-line` (1px rules) |
| Form-control boundary (≥ 3:1) | `border-line-strong` |
| Primary action fill | `bg-primary text-on-primary hover:bg-primary-hover` |
| Accent (links, focus, selection, active) | `text-accent`, `bg-accent`, `bg-accent-subtle` |
| Errors and destructive actions | `text-danger`, `bg-danger-subtle`, `bg-danger text-on-danger` |
| Success / warning status | `text-success` + `bg-success-subtle`, `text-warning` + `bg-warning-subtle` |
| Modal scrim | `bg-overlay` |
| Radii | `rounded-control` (8px: buttons, inputs, rows), `rounded-card` (12px: cards, panels, dialogs), `rounded-full` (pills, avatars, dots) |
| Floating-layer shadow | `shadow-popover` (menus, popovers, dialogs, toasts only) |
| Focus | `focus-ring` (or `focus-ring-inset` inside clipped rows) |
| Touch target | `touch-target` (44px minimum on coarse pointers) |

Never use palette classes (`zinc-500`, `blue-600`, `white`, `black`), `dark:` variants, hex values, or `rgb()`. Themes switch by redefining tokens, so you don't need any of them.

## Rules

- **Type**: `text-xs` (12) for metadata, `text-sm` (14) for UI and body, `text-base` (16) for section titles and reading text, `text-lg` (20) and `text-xl` (24) for page titles only. Use `font-normal` and `font-medium` only.
- **Spacing**: 4px scale. Padding, margin, gap, and inset values are `1 2 3 4 6 8` (4–32px) and `0`/`px`. Use one gap value per layout. Sizes (`w-*`, `h-*`, `size-*`) are free.
- **Accent**: well under 5% of any screen. Use it for links, focus, selected/active indicators, and switches when on. Never for decoration or for the primary button.
- **One primary action per view**: `<Button variant="primary">`. Everything else is `secondary` (outline) or `ghost`.
- **Status colors** are for status messages and destructive actions only, not for decoration. Category badges, file types, and tool names use neutral chips (`bg-muted text-fg-muted`).
- **Flat**: no shadows on in-page cards, no gradients, no blur, no `scale`/`translate` hover effects.
- **Motion**: `transition-colors` or `transition-opacity` with the default 150ms duration. `prefers-reduced-motion` is handled globally.
- **Arbitrary values** (`w-[500px]`, `z-[9999]`, `text-[10px]`) are not allowed. CSS-variable shorthand such as `w-(--anchor-width)` is fine. Floating layers use `z-50`.
- **Icons** inside `Button`/`IconButton`/`MenuItem` are sized automatically (16px). Elsewhere use `size-4`.

## Components

```tsx
import { Button, IconButton } from '@/components/ui/Button';
import { Input, Textarea, NativeSelect, Field } from '@/components/ui/Input';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import Modal from '@/components/ui/Modal'; // open/onClose/title convenience wrapper over Dialog
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator, MenuGroup } from '@/components/ui/Menu';
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from '@/components/ui/Popover';
import { Tabs, TabsList, TabsTab, TabsPanel } from '@/components/ui/Tabs';
import Tooltip from '@/components/ui/Tooltip';
import { Toggle } from '@/components/ui/Toggle'; // Base UI Switch
import { Logo } from '@/components/ui/Logo';
import { cn } from '@/lib/cn';
```

- `Button`: `variant` `primary | secondary | ghost | danger`, `size` `sm (32px) | md (36px)`. `buttonClasses()` returns the same classes for non-button elements, for example a `MenuTrigger`.
- `IconButton`: requires `label` (its accessible name). Keep any existing `title`. `iconButtonClasses()` is the class-only form.
- `Field label description error`: wraps an `Input`/`Textarea` and wires up label, description, and `aria-invalid`.
- `NativeSelect`: a styled native `<select>`, used for simple option lists. It gives a platform picker on touch, and tests drive it with `selectOptions`.
- `Modal`/`Dialog`: Base UI Dialog. It traps focus, closes on Esc and outside click, and restores focus. Sizes are `sm md lg xl full`. Pass a `footer` with one primary button.
- `Menu`: Base UI Menu, for action lists (kebab menus, user menu). `MenuItem tone="danger"` marks destructive items.
- `Popover`: for non-menu floating content (pickers, info panels).
- `Tabs`: Base UI Tabs with an accent underline on the active tab.
- `Tooltip`: supplementary only. Not shown on touch devices.

## Accessibility checklist per screen

- Every control has an accessible name (visible label, `aria-label`, or `IconButton label`).
- No interactive element nested in another (`role="button"` containers with buttons inside are not allowed).
- Hover-revealed actions also appear on `group-focus-within` and on touch (`pointer-coarse:opacity-100`).
- Run axe on the screen in both themes, and tab through it: order is sensible, focus is visible, and dialogs and menus trap and restore focus.
