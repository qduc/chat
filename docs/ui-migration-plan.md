# UI Migration Plan: Design Tokens + Base UI

Status: complete. All screens below use the design tokens and Base UI components. Behavior, routing, data, and API are unchanged.

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

## Results

| Check | Before | After |
| --- | --- | --- |
| Design-lint violations (`npm run lint:design`) | 3,658 in 71 files | 0 in 66 files |
| Hex colors outside `app/tokens.css` | 5 (plus ~60 in the dark syntax theme) | 0 |
| Token contrast pairs meeting WCAG AA (`npm run check:contrast`) | n/a | 178 / 178 |
| axe (WCAG 2.2 A/AA), 17 states × light/dark | 30 of 34 with violations (438 failing nodes) | 0 |
| Keyboard walkthrough (trap, visible focus, restore) | n/a | 0 issues |
| Frontend tests | 534 pass | 534 pass (no test changes) |
| Build warnings | 3 (pre-existing `rewrites` + static export) | same 3 |
| JS (gzip) | 759 KB | 850 KB (+90 KB: Base UI) |
| CSS (gzip) | 21.6 KB | 13.1 KB (−39%) |

## Round 2: layout and usability improvements

These go beyond a pure restyle. They were approved after the migration review.

1. **Sign out on phones:** the user menu is now available at every width. Before, it was hidden below 640px, so there was no way to sign out on a phone.
2. **Phone history drawer:** the drawer closes after you pick a conversation or start a new chat.
3. **Typo:** fixed the copy in the Advanced tab ("…to save on API costs").
4. **System Prompts panel:**
   - Collapsed by default until the user opens it once; after that, the user's choice is remembered.
   - The status line moved under the prompt picker, replacing the footer band.
   - The clear (×) button is disabled when there is nothing to clear.
5. **Composer controls:** they now show "Reasoning", "Params" and "Tools" labels on wider screens, a value chip appears only when something is selected, and Stream is an icon toggle. The placeholder "None" values are gone.
6. **Header:**
   - The model trigger sizes to its content, up to 320px.
   - "Refresh model list" moved into the model popup footer.
   - The theme toggle moved into the user menu. It stays in the header when signed out.
7. **Settings headings:** removed the headings that repeated the tab names. Providers' Refresh is now next to the list it refreshes.
8. **Provider form actions:** the action bar sticks to the bottom of the Settings dialog, so Test Connection and Create/Update stay visible.

## Round 3: calmer composer

- **One control style:** every setting is the same quiet text chip, with values shown inline ("Reasoning: Default", "Tools · 2", "Params · High temp"). Borders, the divider, and the per-control icons and tooltips are gone.
- **Attach** moved to the start of the bottom row, so the message text gets the full width and both rows share one left edge.
- **Stream** moved into the Params popover as a "Stream responses" switch. The Params chip shows "No streaming" when it is off.
- **Send** is a round icon button: softly tinted when empty, solid when ready, and a spinner while streaming. It keeps the accessible names Send and Stop.
- **Reasoning:** the "Unset" option is now labelled "Default". The stored value is unchanged.
- **Removed:** the separate clear (×) buttons next to Tools and Params. Clearing is done inside each popover ("Clear" and "None").
- **Test changes (the only ones in this migration):**
  - `QualitySlider.test.tsx` expects the "Default" label.
  - Two Stream tests in `MessageInput.test.tsx` now open the Params popover before checking or toggling the switch.

## Round 4: chat details panel

The right "System Prompts" sidebar is now a **chat details panel** with folding sections. Empty sections hide themselves, and the open/closed state of each section is remembered.

- **System prompt:** a list of radio buttons replaces the dropdown and the full-height text box.
  - The selected prompt shows a preview, an Edit button and a ⋯ menu (Duplicate, and Delete with a confirmation dialog).
  - Editing happens in place, in a text box that grows with its content, with Revert / Save as new / Save underneath.
  - Fixed: Revert used to empty the text; it now restores the saved prompt.
  - Fixed: the unsaved-changes dialog was never shown; it now appears when you switch prompts with unsaved edits.
- **This chat:** the model, reasoning, tools and params the chat uses, plus when it started.
- **Usage:**
  - Input, cached and output tokens.
  - A context meter: the last request's size against the model's context window.
  - The cost ("Est." when it comes from the catalog), plus how much prompt caching saved.
- **Sources:** pages found by search or fetched by web_fetch, deduplicated, showing 5 with "Show all".
- **Files:** a thumbnail grid of the attachments in the chat.
- **Memory:** the user's Journal entries, which can be deleted.
- **Panel toggle:** a "Chat details" button in the header, at every width, replaces the 64px collapsed strip.

**Backend support:**
- **Model catalog:** copied from `qduc/term2` (context windows and per-token prices) into `backend/src/lib/modelCatalog/`.
- **Cost math:** imported from `@qduc/agent-core`, which is bumped from 0.2.0-alpha.1 to alpha.4 for pricing tiers and 1-hour cache writes.
- **Per-message usage:** messages now store cache-read and cache-write tokens, plus the cost the provider reports, and their `usage` includes a `cost` field.
- **New routes:**
  - `GET /v1/models/info`
  - `GET /v1/journal`
  - `DELETE /v1/journal/:id`
