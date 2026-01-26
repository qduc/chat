# Plan: Merge ModelSelector and CompareSelector

## Overview

Merge the comparison feature into ModelSelector using contextual actions per row. Users can open one dropdown and either select a single model (click name) or build a comparison set (click checkboxes), with minimal friction and cognitive load.

## Goals

- Single dropdown for both single-model and comparison workflows
- Low friction: single-model chat unchanged (2 clicks)
- Comparison accessible without opening separate dropdown
- Minimize code changes to reduce bug risk
- Keep CompareSelector as a separate file (deprecated but available for rollback)

## Components Affected

| File | Change Type |
|------|-------------|
| `frontend/components/ui/ModelSelector.tsx` | Modify |
| `frontend/components/ui/CompareSelector.tsx` | No changes (keep for rollback) |
| `frontend/components/ChatHeader.tsx` | Simplify (remove CompareSelector usage) |

## UI Design

```
┌─────────────────────────────────────┐
│ claude-3-opus                    ▼  │
├─────────────────────────────────────┤
│ 2 in comparison           [Clear]  │  ← comparison header (when >0)
├─────────────────────────────────────┤
│ [All] [OpenAI] [Anthropic]         │  ← provider tabs
├─────────────────────────────────────┤
│ ★ claude-3-opus          ●         │  ← primary indicator
│ ☆ gpt-4o                 ☑         │  ← in comparison
│ ☆ gemini-pro             [+]       │  ← add to comparison
└─────────────────────────────────────┘
```

## Interaction Behavior

| Action | Result |
|--------|--------|
| Click model name | Set as primary model, close dropdown |
| Click star | Toggle favorite, stay open |
| Click [+] or checkbox | Toggle comparison, stay open |
| Click outside | Close dropdown |
| Primary model row | Shows ● indicator, no comparison toggle |

## Implementation Steps

### Step 1: Extend ModelSelector Props

Add new props to ModelSelector interface:
- `selectedComparisonModels`: array of model values in comparison
- `onComparisonModelsChange`: callback when comparison selection changes
- `comparisonDisabled`: boolean to lock comparison
- `comparisonDisabledReason`: tooltip text when disabled

### Step 2: Add Comparison Header

Add conditional header section inside the dropdown:
- Shows when `selectedComparisonModels.length > 0`
- Displays count: "N in comparison"
- "Clear" button to reset comparison selection
- Styled consistently with existing section headers

### Step 3: Modify ModelItem Component

Extend the ModelItem component to include comparison toggle:
- Add `isPrimary` prop to identify current primary model
- Add `isInComparison` prop for comparison state
- Add `onToggleComparison` callback
- Add comparison toggle button (checkbox or [+] icon) on the right side
- Primary model shows ● indicator instead of toggle
- Keep star button and model name click behavior unchanged

### Step 4: Wire Up Comparison Logic

Inside ModelSelector:
- Pass comparison props through to ModelItem
- Handle comparison toggle callback
- Prevent dropdown from closing when toggling comparison or favorites
- Only close dropdown when clicking model name (primary selection)

### Step 5: Update ChatHeader

Simplify ChatHeader to use unified ModelSelector:
- Remove both CompareSelector usages (desktop and mobile)
- Pass comparison props to ModelSelector
- Remove duplicate responsive handling (now internal to ModelSelector)

## What Stays Unchanged

- All existing ModelSelector logic (favorites, recent, search, tabs, virtualization)
- ModelSelectBase component
- CompareSelector file (kept for potential rollback)
- All other components using ModelSelector without comparison feature

## Testing Checklist

- [ ] Single model selection works (click name closes dropdown)
- [ ] Favorites toggle works (stays open)
- [ ] Comparison toggle works (stays open)
- [ ] Primary model cannot be added to comparison
- [ ] Comparison header shows correct count
- [ ] Clear button resets comparison
- [ ] Disabled state works for comparison
- [ ] Keyboard navigation still works
- [ ] Mobile responsive layout works
- [ ] No regression in existing ModelSelector-only usages

## Rollback Plan

If issues arise:
1. Revert ModelSelector changes
2. Revert ChatHeader changes
3. CompareSelector is unchanged and ready to use
