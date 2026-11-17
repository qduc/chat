# UI Migration Plan: Design Tokens + Base UI

Status: in progress. The visual and component layer is being migrated. Behavior, routing, data, and API stay unchanged.

## Audit (baseline, v0.19.0)

The app is a single route (`/`) with these surfaces: the auth gate, the chat shell (left sidebar, header, message list, composer, right "System Prompts" sidebar), and modals (Settings with 3 tabs, Judge, Save-As/Unsaved prompt, image/file previews).

| Finding | Count / detail |
| --- | --- |
| Raw Tailwind palette classes (`zinc-*`, `slate-*`, `blue-*`...) | ~2,250 across 60 TSX files. 5 gray families are mixed (zinc, slate, gray, neutral, stone). |
| `dark:` overrides | ~1,070. Dark mode works by swapping each class, not through tokens. |
| Semantic token usage | 0. `globals.css` defines shadcn-style vars, but no component uses them. |
| Accent usage | Blue is used for primary buttons, avatars, and tabs, alongside emerald, amber, purple, and orange decorations. |
| Shadows / blur / gradients | ~70 shadow utilities (`shadow-2xl` on modals), 13 `backdrop-blur`, and a gradient on the auth page and the composer fade. |
| Radii | 9 different radii (`rounded` through `rounded-3xl`). |
| Font weights | `font-semibold` and `font-bold` alongside 400/500. |
| Arbitrary values | `text-[10px]`, `z-[9999]` ... `z-[10002]`, and pixel widths. |
| Hand-rolled interactive primitives | `Modal` (no focus trap, no focus restore), `UserMenu` (no menu roles or arrow keys), `Tooltip`/`IconSelect`/`TabbedSelect` on `@floating-ui`, the settings "tabs" (plain buttons, no tablist), `Toggle` (manual `role=switch`), and the prompt dropdown. |
| Dead code | `ui/IconSelect.tsx`, `ui/HeaderButton.tsx`, and `ui/CompareSelector.tsx` are imported nowhere. |
| Syntax highlighting | The light theme comes from the `atom-one-light.css` import. The dark theme is about 60 lines of hard-coded hex values. |

## Design system (foundation)

- **Tokens** live only in `frontend/app/tokens.css`. The raw palette (`--gray-*`, `--blue-*`) is private to that file. The semantic layer (`--color-canvas`, `--color-fg-muted`, `--color-accent`, ...) is redefined for dark mode. Tailwind's `@theme inline` maps the semantic tokens to utilities (`bg-canvas`, `text-fg-muted`, `border-border`, `ring-focus`).
- **Palette**: neutral grays plus one accent (blue). Status colors (danger, success, warning) are reserved for status messages and destructive actions. Every text token meets 4.5:1 on every surface token in both themes. Control borders and focus rings meet 3:1.
- **Type**: Geist, weights 400/500, scale 12 / 14 / 16 / 20 / 24.
- **Spacing**: 4px base. Only 4, 8, 12, 16, 24, 32 (`1 2 3 4 6 8`) are used for padding, margin, and gap.
- **Radii**: `rounded-control` (8px) and `rounded-card` (12px). Pills and avatars use `rounded-full`.
- **Surfaces**: flat, with hairline `border-border`. No shadows except a single faint `shadow-popover` on floating layers. No blur and no gradients.
- **Motion**: 150ms color/opacity transitions only, disabled under `prefers-reduced-motion`.

### Shared components (`frontend/components/ui/`)

Each is a thin, typed wrapper. Interactive behavior comes from `@base-ui/react`.

| Component | Built on | Replaces |
| --- | --- | --- |
| `Button`, `IconButton` | native `<button>` | ~150 ad-hoc button class strings |
| `Input`, `Textarea`, `Field` (label/description/error) | native + Base UI `Field` | ad-hoc inputs |
| `Dialog` (and `Modal` re-implemented on top) | Base UI `Dialog` | `ui/Modal.tsx` portal |
| `Menu` | Base UI `Menu` | `UserMenu` dropdown, kebab menus |
| `Select` | Base UI `Select` | native/hand-rolled selects |
| `Tabs` | Base UI `Tabs` | settings tabs, model selector groups |
| `Tooltip` | Base UI `Tooltip` | `@floating-ui` tooltip |
| `Popover` | Base UI `Popover` | model selector, prompt dropdown |
| `Switch` (`Toggle` API kept) | Base UI `Switch` | `ui/Toggle.tsx` |
| `Toast` | restyle only (existing API) | — |

## Migration order

Each step leaves the app building, linting, and passing tests. The legacy styles and components for a step are deleted in that same step.

1. **Foundation**: tokens, `cn()`, base components, and a token checker script.
2. **Auth gate**: login and register. Small and self-contained, so it pilots the patterns.
3. **App shell**: layout, header, left sidebar, user menu, theme toggle, scroll buttons.
4. **Model selector**: header popover, search, provider tabs, compare selection.
5. **Composer**: `MessageInput`, attachment previews, reasoning/tools controls.
6. **Conversation**: message list, user/assistant messages, toolbar, markdown/code, tool and reasoning blocks, compare columns, judge modal.
7. **System prompts sidebar**: right sidebar and prompt manager modals.
8. **Settings**: modal, Providers, Search Engines, Advanced.
9. **Cleanup**: remove legacy CSS vars, reset Tailwind's default color palette, drop `@floating-ui/react` if unused, run the final audits.
