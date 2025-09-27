# Prompt Manager Components

This directory contains React components for the System Prompt Management feature.

## Component Structure

- `PromptList.tsx` - Lists built-in and custom prompts with grouping
- `PromptEditor.tsx` - Inline editing interface for prompt content
- `UnsavedChangesModal.tsx` - Modal for handling unsaved changes when switching prompts

## Integration

These components will be integrated into the right sidebar (`RightSidebar.tsx`) as a new panel alongside existing system prompt configuration.

## State Management

Components use the `useSystemPrompts` hook for:
- Fetching prompt lists from the backend
- Managing CRUD operations
- Handling local inline editing state
- Persisting ephemeral changes to localStorage

## Design Notes

- Built-in prompts are read-only and displayed at the top
- Custom prompts are sorted by last_used_at descending
- Active prompt shows an asterisk (*) when unsaved changes exist
- Switching prompts with unsaved edits triggers confirmation modal