# Phase 1.5: State Management Updates

## Overview
Update the existing chat state management to include user authentication context and handle auth-related state transitions.

## Tasks

### 1. Update Chat State Interface
**File**: `frontend/hooks/useChatState.ts`

```typescript
export interface ChatState {
  // Add user context
  user: User | null;
  isAuthenticated: boolean;
  // ... existing fields
}

// Add authentication actions
export type ChatAction =
  | { type: 'SET_USER'; payload: User | null }
  | { type: 'SET_AUTHENTICATED'; payload: boolean }
  // ... existing actions
```

### 2. Update Chat Reducer
Add handlers for new authentication actions:
- `SET_USER` - Updates user information
- `SET_AUTHENTICATED` - Updates authentication status
- Handle user state changes in conversation loading

### 3. Update Chat Hook Integration
Modify chat hooks to:
- Initialize user state from auth context
- Handle authentication state changes
- Update conversation loading based on auth status

### 4. Update Components for Auth State
**Components to update**:
- `ChatV2` - Main container should respond to auth changes
- `ChatSidebar` - Show user-specific conversations
- `MessageInput` - Enable/disable based on auth state
- Any components showing user-specific data

### 5. Handle Auth State Transitions
Implement logic for:
- Anonymous to authenticated user migration
- Conversation ownership transfer
- State persistence during auth changes

## Acceptance Criteria
- [ ] Chat state includes user authentication data
- [ ] State transitions handle auth changes smoothly
- [ ] Components respond correctly to auth state
- [ ] Anonymous to authenticated migration works
- [ ] No data loss during auth transitions
- [ ] State persistence works correctly

## Dependencies
- Phase 1.4 (Frontend Authentication Integration)

## Estimated Time
4-6 hours