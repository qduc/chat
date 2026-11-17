# Prompt Manager Components

Modals used by the "System prompt" section of the chat details panel (`components/details/SystemPromptSection.tsx`).

## Component Structure

- `SaveAsModal.tsx` - `Modal` that saves the current content as a new prompt, with name validation.
- `UnsavedChangesModal.tsx` - `Modal` shown when switching prompts while the current one has unsaved inline edits: save, save as new, discard, or cancel.

The picker and editor themselves live in `components/details/`:
- `PromptRadioList.tsx` - native radio group: "None", built-ins (ordered by `order`), then custom prompts (most recently used first).
- `PromptEditor.tsx` - auto-growing textarea with Revert / Save as new / Save.

## State Management

`SystemPromptSection` uses the `useSystemPrompts` hook for:
- Fetching prompt lists from the backend
- Managing CRUD operations
- Handling local inline editing state
- Persisting ephemeral changes to localStorage

## Design Notes

- Styling follows `docs/design-system.md`: semantic tokens only and shared `components/ui` primitives. Each modal has one primary button in its `footer`.
- Built-in prompts are read-only and marked with a neutral "Built-in" chip; edits to them apply to the current chat only.
- A prompt with unsaved inline edits shows an accent dot and "Edited" next to its name.
- Deleting a custom prompt is confirmed with a `Dialog`.
