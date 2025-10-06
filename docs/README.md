# useChatState Hook - Refactored Structure

> **Status:** Phase 2 Complete ✅
> **Last Updated:** October 4, 2025

## Overview

This directory contains the refactored `useChatState` hook, broken down into modular, maintainable pieces.

## Structure

```
useChatState/
├── index.ts                  # Main export (re-exports for backward compatibility)
├── types.ts                  # TypeScript interfaces and types
├── initialState.ts           # Default state and constants
├── reducer.ts                # Main reducer (delegates to sub-reducers)
├── reducers/                 # NEW: Domain-specific sub-reducers
│   ├── index.ts              # Combined reducer orchestrator
│   ├── authReducer.ts        # Authentication state
│   ├── uiReducer.ts          # UI state (input, images, sidebars)
│   ├── settingsReducer.ts   # Model, provider, tools settings
│   ├── conversationReducer.ts # Conversation CRUD
│   ├── streamReducer.ts     # Message streaming
│   └── editReducer.ts       # Message editing
├── utils/
│   ├── qualityMapping.ts     # Quality level mappings
│   ├── streamHelpers.ts      # Stream event processing utilities
│   └── chatConfigBuilder.ts  # Chat configuration builder
└── REFACTOR_PROGRESS.md      # Detailed refactor progress tracking
```

## Usage

### For Consumers

Import remains unchanged:
```typescript
import { useChatState } from '../hooks/useChatState';

function MyComponent() {
  const { state, actions } = useChatState();
  // ... rest of component
}
```

### For Maintainers

When modifying the chat state system:

1. **Adding new types:** Edit `types.ts`
2. **Adding new constants:** Edit `initialState.ts`
3. **Adding new reducer logic:** Edit the appropriate sub-reducer in `reducers/`
   - Authentication → `reducers/authReducer.ts`
   - UI state → `reducers/uiReducer.ts`
   - Settings → `reducers/settingsReducer.ts`
   - Conversations → `reducers/conversationReducer.ts`
   - Streaming → `reducers/streamReducer.ts`
   - Editing → `reducers/editReducer.ts`
4. **Adding new utilities:** Create in `utils/`

## Key Files

### types.ts
Defines all TypeScript interfaces and type definitions:
- `ChatState` - Main state shape
- `ChatAction` - All action types
- `PendingState` - Pending operation state
- `ToolSpec` - Tool specification type

### initialState.ts
Contains default values and constants:
- `initialState` - Initial chat state
- `availableTools` - Tool definitions (get_time, web_search)

### reducer.ts
Thin wrapper that delegates to combined reducer:
- Imports `combinedReducer` from `reducers/`
- ~15 lines (down from ~330)
- Clean abstraction layer

### reducers/ (NEW in Phase 2)
Domain-specific sub-reducers for better organization:

#### reducers/index.ts
Combined reducer orchestrator:
- Tries each sub-reducer in sequence
- First non-null result wins
- Clean composition pattern

#### reducers/authReducer.ts
Authentication state management:
- `SET_USER` - Set user object
- `SET_AUTHENTICATED` - Set auth status
- ~20 lines

#### reducers/uiReducer.ts
UI state management:
- `SET_INPUT` - Update input text
- `SET_IMAGES` - Update image attachments
- `TOGGLE_SIDEBAR` - Toggle left sidebar
- `SET_SIDEBAR_COLLAPSED` - Set left sidebar state
- `TOGGLE_RIGHT_SIDEBAR` - Toggle right sidebar
- `SET_RIGHT_SIDEBAR_COLLAPSED` - Set right sidebar state
- `CLEAR_ERROR` - Clear error state
- ~50 lines

#### reducers/settingsReducer.ts
Settings and configuration:
- `SET_MODEL` - Change model
- `SET_PROVIDER_ID` - Change provider
- `SET_USE_TOOLS` - Enable/disable tools
- `SET_SHOULD_STREAM` - Toggle streaming
- `SET_REASONING_EFFORT` - Set reasoning effort
- `SET_VERBOSITY` - Set verbosity level
- `SET_QUALITY_LEVEL` - Set quality level (updates effort & verbosity)
- `SET_SYSTEM_PROMPT` - Update system prompt
- `SET_INLINE_SYSTEM_PROMPT_OVERRIDE` - Override prompt inline
- `SET_ACTIVE_SYSTEM_PROMPT_ID` - Set active prompt ID
- `SET_ENABLED_TOOLS` - Update enabled tools list
- `SET_MODEL_LIST` - Update available models
- `SET_LOADING_MODELS` - Set loading state
- ~60 lines

#### reducers/conversationReducer.ts
Conversation CRUD operations:
- `SET_CONVERSATION_ID` - Switch conversations
- `SET_CURRENT_CONVERSATION_TITLE` - Update title
- `LOAD_CONVERSATIONS_START` - Start loading
- `LOAD_CONVERSATIONS_SUCCESS` - Load complete
- `LOAD_CONVERSATIONS_ERROR` - Load failed
- `SET_HISTORY_ENABLED` - Enable/disable history
- `ADD_CONVERSATION` - Add new conversation
- `DELETE_CONVERSATION` - Delete conversation
- `NEW_CHAT` - Start new chat
- ~65 lines

#### reducers/streamReducer.ts
Streaming and message management:
- `START_STREAMING` - Begin stream
- `REGENERATE_START` - Begin regeneration
- `STREAM_TOKEN` - Apply token
- `STREAM_TOOL_CALL` - Apply tool call
- `STREAM_TOOL_OUTPUT` - Apply tool output
- `STREAM_USAGE` - Apply usage metadata
- `STREAM_COMPLETE` - Stream finished
- `STREAM_ERROR` - Stream error
- `STOP_STREAMING` - Stop stream
- `CLEAR_MESSAGES` - Clear all messages
- `SET_MESSAGES` - Set message array
- `SYNC_ASSISTANT` - Sync assistant message
- ~120 lines

#### reducers/editReducer.ts
Message editing:
- `START_EDIT` - Begin editing
- `UPDATE_EDIT_CONTENT` - Update edit content
- `CANCEL_EDIT` - Cancel editing
- `SAVE_EDIT_SUCCESS` - Save edit
- ~35 lines

### utils/qualityMapping.ts
Maps quality levels to settings:
```typescript
quick → { reasoningEffort: 'minimal', verbosity: 'low' }
balanced → { reasoningEffort: 'medium', verbosity: 'medium' }
thorough → { reasoningEffort: 'high', verbosity: 'high' }
```

### utils/streamHelpers.ts
Stream event processing utilities:
- `upsertToolCall()` - Merge incremental tool calls
- `applyStreamToken()` - Apply token to message
- `applyStreamToolCall()` - Apply tool call to message
- `applyStreamToolOutput()` - Apply tool output to message
- `applyStreamUsage()` - Apply usage metadata to message

### utils/chatConfigBuilder.ts
Builds chat request configurations:
- `buildChatConfig()` - Assembles config from refs and state
- Type definitions for config components

## Benefits of Refactor

### Before (Single File)
- ✗ 1374 lines in one file
- ✗ Difficult to navigate
- ✗ Hard to test specific functionality
- ✗ Unclear dependencies
- ✗ Git merge conflicts

### After Phase 1
- ✓ 8 focused files (~200 lines each max)
- ✓ Clear separation of concerns
- ✓ Easier to test utilities
- ✓ Explicit dependencies via imports
- ✓ Smaller, focused changes

### After Phase 2 (Current)
- ✓ 14 focused files (~120 lines each max)
- ✓ Domain-specific reducers
- ✓ Easy to locate action handlers
- ✓ Independent testing per domain
- ✓ Team can work in parallel
- ✓ Clear module ownership

## Future Phases

See `REFACTOR_PROGRESS.md` for detailed plans:

- **Phase 2:** ✅ **COMPLETE** - Split reducer into domain-specific sub-reducers
- **Phase 3:** Extract action creators into separate files
- **Phase 4:** Extract custom hooks (useStreamHandlers, useModelLoader, etc.)
- **Phase 5:** Final cleanup and optimization

## Testing

### Current
- Manual verification: ✅ App compiles
- Manual verification: ✅ No runtime errors
- Existing tests: 🔲 Pending execution

### Planned
- Unit tests for stream helpers
- Unit tests for quality mapping
- Unit tests for reducer
- Integration tests for full hook

## Migration Notes

### Backward Compatibility
All exports maintain backward compatibility. No changes needed for existing code importing `useChatState`.

### Adding New Features
1. Determine which module the feature belongs to
2. Add types to `types.ts` if needed
3. Add action type to `ChatAction` union in `types.ts`
4. Add reducer case in `reducer.ts`
5. Add action creator in main `useChatState.ts` (will be extracted in Phase 3)

## Common Patterns

### Adding a New Setting
```typescript
// 1. types.ts - Add to ChatState
export interface ChatState {
  // ... existing
  myNewSetting: string;
}

// 2. types.ts - Add action type
export type ChatAction =
  // ... existing
  | { type: 'SET_MY_NEW_SETTING'; payload: string };

// 3. initialState.ts - Add default value
export const initialState: ChatState = {
  // ... existing
  myNewSetting: 'default',
};

// 4. reducer.ts - Add case
case 'SET_MY_NEW_SETTING':
  return { ...state, myNewSetting: action.payload };

// 5. useChatState.ts - Add action creator
setMyNewSetting: useCallback((value: string) => {
  dispatch({ type: 'SET_MY_NEW_SETTING', payload: value });
}, []),
```

### Adding a Stream Helper
```typescript
// utils/streamHelpers.ts
export function myNewStreamHelper(messages: any[], ...args) {
  // implementation
  return updatedMessages;
}

// reducer.ts
import { myNewStreamHelper } from './utils/streamHelpers';

case 'MY_NEW_STREAM_ACTION':
  return {
    ...state,
    messages: myNewStreamHelper(state.messages, action.payload)
  };
```

## Questions?

Check `REFACTOR_PROGRESS.md` for:
- Detailed phase breakdown
- Known issues
- Next steps
- Discussion points

## Contributors

- AI Assistant (Phase 1 refactor)
- Your name here (future phases!)
