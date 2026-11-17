# Prompt Manager Components

React components for the System Prompts right sidebar (`components/RightSidebar.tsx`).

## Component Structure

- `PromptDropdown.tsx` - Prompt picker. A `Menu` from `components/ui` with radio items: "No system prompt", built-ins (ordered by `order`), then custom prompts (most recently used first).
- `SaveAsModal.tsx` - `Modal` that saves the current content as a new prompt, with name validation.
- `UnsavedChangesModal.tsx` - `Modal` for handling unsaved changes: save, save as new, discard, or cancel.

## State Management

`RightSidebar` uses the `useSystemPrompts` hook for:
- Fetching prompt lists from the backend
- Managing CRUD operations
- Handling local inline editing state
- Persisting ephemeral changes to localStorage

## Design Notes

- Styling follows `docs/design-system.md`: semantic tokens only and shared `components/ui` primitives. Each modal has one primary button in its `footer`.
- Built-in prompts are read-only and marked with a neutral "Built-in" chip.
- A prompt with unsaved changes shows an asterisk (`*`, `text-accent` in the menu); the sidebar shows an accent dot with a note.
