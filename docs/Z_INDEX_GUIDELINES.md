# Z-Index Guidelines

This document defines the z-index stacking order for the ChatForge application to prevent layering conflicts and ensure consistent UI behavior.

## Z-Index Hierarchy

### Level 1: Base Content (z-0 to z-9)
- Default content: `z-0` (default)
- Small tooltips: `z-10`

### Level 2: Layout Components (z-10 to z-39)
- Sidebars: `z-30`
  - ChatSidebar: `z-30`
  - RightSidebar: `z-30`
  - Message input container: `z-30`

### Level 3: Navigation & Controls (z-40 to z-49)
- Header: `z-40`
- Interactive buttons on sidebars: `z-40`
  - ChatSidebar toggle button: `z-40`
  - RightSidebar toggle button: `z-40`

### Level 4: Dropdowns & Popups (z-50 to z-99)
- All dropdowns and popups: `z-50`
  - ModelSelector dropdown: `z-50`
  - UserMenu dropdown: `z-50`
  - MessageInput tool config popup: `z-50`
  - PromptDropdown: `z-50`
  - SaveAsModal: `z-50`
  - UnsavedChangesModal: `z-50`

### Level 5: High-Priority Modals (z-10000+)
- Main application modals: `z-[10000]`
  - Modal component: `z-[10000]`
  - SettingsModal delete confirmation: `z-[10001]`

## Rules and Best Practices

### 1. Consistent Values
- Use predefined z-index values from the hierarchy above
- Don't create arbitrary z-index values
- Group similar components at the same level

### 2. Component Relationships
- Child interactive elements should have higher z-index than their containers
- Toggle buttons (`z-40`) are higher than their parent sidebars (`z-30`)
- Header (`z-40`) is higher than sidebars (`z-30`) for dropdown positioning

### 3. Modal Conventions
- Use `z-50` for inline dropdowns and popups
- Use `z-[10000]+` for full-screen modals and overlays
- Increment by 1 for stacked modals (e.g., confirmation dialogs over settings)

### 4. When Adding New Components

**For dropdowns/popups:**
```tsx
className="absolute ... z-50"
```

**For layout components:**
```tsx
className="... z-30"
```

**For modal overlays:**
```tsx
className="fixed inset-0 ... z-[10000]"
```

### 5. Testing Z-Index
When adding or modifying components with z-index:

1. Test with all sidebars open
2. Test with dropdowns open simultaneously
3. Test modal interactions
4. Verify toggle buttons remain clickable
5. Ensure header dropdowns appear above sidebars

## Current Component Mapping

| Component | Z-Index | Level |
|-----------|---------|-------|
| ChatSidebar | `z-30` | Layout |
| RightSidebar | `z-30` | Layout |
| ChatHeader | `z-40` | Navigation |
| Toggle buttons | `z-40` | Controls |
| All dropdowns | `z-50` | Popups |
| Modal component | `z-[10000]` | High-priority |

## Migration Notes

- **2024-12-29**: Fixed toggle button conflicts (z-10 → z-40)
- **2024-12-29**: Fixed header layering (z-10 → z-40)
- **2024-12-29**: Standardized all dropdown z-index to z-50