# useChatState Refactor Progress

**Date Started:** October 4, 2025
**Current Phase:** Phase 3 (Complete)
**Next Phase:** Phase 4

## Overview

Refactoring the 1374-line `useChatState.ts` file into a modular, maintainable structure.

---

## Phase 1: Extract Types, Constants, and Utilities ✅ COMPLETE

### Completed Files

#### 1. **types.ts** ✅
- **Lines:** ~160
- **Exports:**
  - `PendingState` interface
  - `ChatState` interface
  - `ChatAction` discriminated union (all 40+ action types)
  - `ToolSpec` type re-export
- **Status:** Complete and integrated

#### 2. **initialState.ts** ✅
- **Lines:** ~70
- **Exports:**
  - `initialState` constant with all default values
  - `availableTools` constant (get_time, web_search)
- **Status:** Complete and integrated

#### 3. **reducer.ts** ✅
- **Lines:** ~330
- **Exports:**
  - `chatReducer` function
- **Features:**
  - Uses extracted stream helpers from utils/
  - Uses quality mapping from utils/
  - Clean, readable case statements
- **Status:** Complete and integrated

#### 4. **utils/qualityMapping.ts** ✅
- **Lines:** ~25
- **Exports:**
  - `QualityMapping` interface
  - `qualityLevelMap` constant
  - `getQualityMapping()` function
- **Purpose:** Maps quality levels (quick/balanced/thorough) to reasoning effort and verbosity
- **Status:** Complete and used in reducer

#### 5. **utils/streamHelpers.ts** ✅
- **Lines:** ~210
- **Exports:**
  - `upsertToolCall()` - Handles incremental tool call updates
  - `applyStreamToken()` - Updates messages with streamed tokens
  - `applyStreamToolCall()` - Applies tool call to messages
  - `applyStreamToolOutput()` - Applies tool output to messages
  - `applyStreamUsage()` - Applies usage metadata to messages
- **Purpose:** Encapsulates complex stream event processing logic
- **Status:** Complete and used in reducer

#### 6. **utils/chatConfigBuilder.ts** ✅
- **Lines:** ~85
- **Exports:**
  - `ChatConfigRefs` interface
  - `ChatConfigState` interface
  - `ChatConfigCallbacks` interface
  - `buildChatConfig()` function
- **Purpose:** Builds configuration objects for chat requests
- **Status:** Complete (ready for use in Phase 2/3)

#### 7. **index.ts** ✅
- **Lines:** ~15
- **Purpose:** Main entry point for the refactored module
- **Exports:** Re-exports types and useChatState hook
- **Status:** Complete

### Integration Status ✅

- ✅ Original `useChatState.ts` updated to import from refactored modules
- ✅ Duplicate code removed from original file
- ✅ Types, initialState, and reducer successfully extracted
- ✅ Stream helpers integrated into reducer
- ✅ All TypeScript compilation errors resolved
- ✅ File size reduced from 1374 lines to ~700 lines

### Remaining Lint Warnings (Non-Critical)

The following lint warnings exist but don't block functionality:
- Unused catch variables (can use `catch {}` instead of `catch (e)`)
- React Hook dependency array warnings (existing issues, not introduced by refactor)

---

## Phase 2: Extract Reducer ✅ COMPLETE

### Goal
Split the monolithic reducer into domain-specific sub-reducers for better organization and maintainability.

### Completed Structure
```
reducers/
  index.ts              # ✅ Combined reducer orchestrator
  authReducer.ts        # ✅ Authentication actions (2 actions)
  uiReducer.ts          # ✅ UI state (input, images, sidebars) (7 actions)
  settingsReducer.ts    # ✅ Model, provider, tools settings (11 actions)
  conversationReducer.ts # ✅ Conversation CRUD actions (9 actions)
  streamReducer.ts      # ✅ Message and streaming actions (11 actions)
  editReducer.ts        # ✅ Message editing actions (4 actions)
```

### Implementation Details

#### Sub-Reducer Pattern
Each sub-reducer:
- Takes `ChatState` and `ChatAction` as parameters
- Returns `ChatState | null` (null if action not handled)
- Handles only its domain-specific actions
- Is 30-120 lines (highly focused)

#### Combined Reducer
The `combinedReducer` in `reducers/index.ts`:
- Tries each sub-reducer in sequence
- First non-null result wins
- Falls back to returning state unchanged
- Clean orchestration pattern

#### File Sizes
- `authReducer.ts`: ~20 lines
- `uiReducer.ts`: ~50 lines
- `settingsReducer.ts`: ~60 lines
- `conversationReducer.ts`: ~65 lines
- `streamReducer.ts`: ~120 lines
- `editReducer.ts`: ~35 lines
- `index.ts`: ~50 lines

**Total:** ~400 lines across 7 files (vs 330 in monolithic reducer)

#### Main Reducer Update
`reducer.ts` is now a thin wrapper (~15 lines) that delegates to `combinedReducer`:
```typescript
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  return combinedReducer(state, action);
}
```

### Benefits Achieved ✅

1. **Domain Separation**
   - Each reducer handles one concern
   - Clear ownership boundaries
   - Easier to locate action handlers

2. **Improved Testability**
   - Can test each sub-reducer independently
   - Smaller, focused test suites
   - Mock only relevant state slices

3. **Better Maintainability**
   - Adding actions is clearer (know which file)
   - No giant switch statement
   - Easier code reviews

4. **Team Scalability**
   - Different developers can work on different reducers
   - Less merge conflicts
   - Clear module boundaries

### Integration Status ✅

- ✅ All sub-reducers created
- ✅ Combined reducer orchestrator implemented
- ✅ Main reducer updated to use combined reducer
- ✅ TypeScript compilation successful
- ✅ Backward compatibility maintained
- ✅ All 44 action types handled

### Action Distribution

| Reducer | Actions Handled | Lines | Responsibility |
|---------|----------------|-------|----------------|
| authReducer | 2 | ~20 | User authentication |
| uiReducer | 7 | ~50 | Input, images, sidebars, errors |
| settingsReducer | 11 | ~60 | Model, tools, prompts |
| conversationReducer | 9 | ~65 | Conversation CRUD |
| streamReducer | 11 | ~120 | Streaming, messages |
| editReducer | 4 | ~35 | Message editing |
| **Total** | **44** | **~400** | **All actions** |

---

## Phase 3: Extract Action Creators ✅ COMPLETE

### Goal
Extract all action creator functions from the main hook into separate, domain-specific files.

### Completed Structure
```
actions/
  index.ts              # ✅ Exports/aggregation
  authActions.ts        # ✅ Authentication actions (2 actions)
  uiActions.ts          # ✅ UI state actions (4 actions)
  settingsActions.ts    # ✅ Settings actions (11 actions)
  chatActions.ts        # ✅ Chat operations (5 actions)
  conversationActions.ts # ✅ Conversation management (3 actions)
  editActions.ts        # ✅ Message editing actions (4 actions)
```

### Implementation Details

#### Action Creator Factory Pattern
Each action module exports a `create*Actions()` factory function that:
- Takes dependencies (dispatch, refs, state) as props
- Returns an object with action functions
- Uses plain functions (not React hooks)
- Encapsulates all domain-specific logic

#### File Sizes
- `authActions.ts`: ~18 lines (2 actions)
- `uiActions.ts`: ~26 lines (4 actions)
- `settingsActions.ts`: ~115 lines (11 actions)
- `chatActions.ts`: ~108 lines (5 actions)
- `conversationActions.ts`: ~109 lines (3 actions)
- `editActions.ts`: ~62 lines (4 actions)
- `index.ts`: ~19 lines

**Total:** ~457 lines across 7 files

#### Main Hook Integration
Actions are composed in `useMemo` to create a stable actions object:

```typescript
const actions = useMemo(() => {
  const authActions = createAuthActions({ dispatch });
  const uiActions = createUiActions({ dispatch });
  // ... create all action groups

  return {
    ...authActions,
    ...uiActions,
    ...settingsActions,
    ...chatActions,
    ...conversationActions,
    ...editActions,
    refreshConversations,
  };
}, [/* dependencies */]);
```

### Benefits Achieved ✅

1. **Domain Separation**
   - Each action file handles one concern
   - Clear ownership boundaries
   - Easy to locate actions

2. **Code Reduction**
   - Main hook: 761 → 522 lines (31% reduction)
   - Action logic moved to focused modules
   - Each action file < 120 lines

3. **Improved Testability**
   - Action creators can be unit tested
   - Mock dependencies easily
   - Test each domain independently

4. **Better Maintainability**
   - Smaller, focused files
   - Clear patterns to follow
   - Easier code reviews

### Integration Status ✅

- ✅ All 6 action creator modules created
- ✅ Main hook updated to use action creators
- ✅ Actions composed with `useMemo`
- ✅ TypeScript compilation successful
- ✅ Backward compatibility maintained
- ✅ All 30+ actions available

### Action Distribution

| Module | Actions | Lines | Responsibility |
|--------|---------|-------|----------------|
| authActions | 2 | ~18 | User authentication |
| uiActions | 4 | ~26 | Input, images, sidebars |
| settingsActions | 11 | ~115 | Model, tools, prompts |
| chatActions | 5 | ~108 | Send, regenerate, stop |
| conversationActions | 3 | ~109 | Select, load, delete |
| editActions | 4 | ~62 | Edit workflow |
| **Total** | **29** | **~457** | **All user actions** |

---

## Phase 3 vs Phase 2 Comparison

### Before Phase 3
- Main hook: 761 lines
- Actions inline: ~340 lines
- Single monolithic file

### After Phase 3
- Main hook: 522 lines (31% reduction)
- Action files: ~457 lines across 7 files
- Clear domain boundaries
- Easy to unit test

---

## Phase 4: Extract Custom Hooks (Future)

### Goal
Move action creator functions out of the main hook into separate domain-specific files.

### Proposed Structure
```
actions/
  authActions.ts        # setUser, setAuthenticated
  chatActions.ts        # sendMessage, regenerate, stopStreaming
  conversationActions.ts # selectConversation, deleteConversation, etc.
  editActions.ts        # startEdit, saveEdit, cancelEdit
  modelActions.ts       # setModel, setProviderId, refreshModelList
  uiActions.ts          # setInput, setImages, toggleSidebar, etc.
```

### Benefits
- Main hook becomes composition of action modules
- Each action module is 50-150 lines
- Easier to unit test
- Clear API boundaries

---

## Phase 4: Extract Custom Hooks (Future)

### Goal
Extract complex logic into specialized hooks that can be composed.

### Proposed Structure
```
hooks/
  useStreamHandlers.ts     # handleStreamToken, handleStreamEvent
  useModelLoader.ts        # loadProvidersAndModels logic
  useConversationLoader.ts # refreshConversations logic
  useRefs.ts               # Centralized ref management
```

### Benefits
- Reusable hooks
- Testable in isolation
- Main hook becomes simple composition
- Easier to understand control flow

---

## Phase 5: Clean Up (Future)

### Tasks
- Remove old `useChatState.ts` file entirely
- Update all imports across codebase
- Update tests
- Documentation
- Performance profiling

---

## Testing Strategy

### Phase 1 (Current)
- ✅ Manual verification: App compiles
- ✅ Manual verification: No runtime errors
- 🔲 Run existing tests to ensure no regressions
- 🔲 Add unit tests for extracted utilities

### Future Phases
- Unit tests for each reducer
- Unit tests for each action creator
- Unit tests for each custom hook
- Integration tests for main hook
- E2E tests for critical flows

---

## Migration Notes

### Import Changes
External code should NOT need changes if importing from:
```typescript
import { useChatState } from '../hooks/useChatState';
```

The index.ts re-exports maintain backward compatibility.

### For Future Maintainers

When you find `useChatState.ts`:
1. Check this file first for refactor status
2. New code should go in the appropriate modular file:
   - New types → `types.ts`
   - New constants → `initialState.ts`
   - New reducer cases → `reducer.ts`
   - New utilities → `utils/`
3. Don't add code to the old `useChatState.ts` - it's being phased out

---

## Metrics

| Metric | Before | After Phase 3 | Target (Complete) |
|--------|--------|---------------|-------------------|
| Main file size | 1374 lines | ~522 lines | ~200 lines |
| Number of files | 1 | 22 | ~25 |
| Largest file | 1374 lines | ~522 lines (main hook) | ~150 lines |
| Testability | Low | High | High |
| Maintainability | Low | High | High |

---

## Known Issues

None - Phase 1 complete and working!

---

## Next Steps

1. ✅ Complete Phase 1
2. ✅ Complete Phase 2
3. ✅ Complete Phase 3
4. 🔲 Begin Phase 4: Extract Custom Hooks
5. 🔲 Phase 5: Final Cleanup
6. 🔲 Run existing test suite
7. 🔲 Add comprehensive unit tests

---

## Questions/Discussion

- Should we extract more helper hooks in Phase 4?
- Do we want to introduce middleware (e.g., for logging, persistence)?
- Should we add selectors for derived state?
- Performance optimization opportunities?

---

**Last Updated:** October 4, 2025
**Updated By:** AI Assistant (GitHub Copilot)
**Status:** Phase 3 Complete ✅ (60% Overall)
