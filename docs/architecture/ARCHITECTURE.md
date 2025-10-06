# useChatState Architecture

## File Dependencies

```
┌─────────────────────────────────────────────────────────────┐
│ External Consumers                                           │
│ (ChatV2.tsx, etc.)                                          │
└────────────────┬────────────────────────────────────────────┘
                 │ import { useChatState }
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ index.ts                                                     │
│ • Re-exports types                                          │
│ • Re-exports useChatState hook                              │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ ../useChatState.ts (Main Hook Implementation)               │
│ • useState/useReducer logic                                 │
│ • Action creators                                           │
│ • Effects and event handlers                                │
│ • Refs management                                           │
└─┬───────────┬───────────┬───────────┬───────────────────────┘
  │           │           │           │
  │           │           │           │
  ↓           ↓           ↓           ↓
┌───────┐ ┌────────┐ ┌──────────┐ ┌──────┐
│types  │ │initial │ │reducer   │ │utils/│
│.ts    │ │State   │ │.ts       │ │      │
│       │ │.ts     │ │          │ │      │
└───────┘ └────────┘ └─────┬────┘ └──┬───┘
                           │          │
                           ↓          ↓
                    ┌──────────┐ ┌────────────┐
                    │quality   │ │stream      │
                    │Mapping   │ │Helpers     │
                    │.ts       │ │.ts         │
                    └──────────┘ └────────────┘
                                 ┌────────────┐
                                 │chatConfig  │
                                 │Builder.ts  │
                                 └────────────┘
```

## Data Flow

### State Updates

```
User Action
    ↓
Event Handler in Hook
    ↓
dispatch({ type: 'ACTION_TYPE', payload: ... })
    ↓
reducer.ts
    ↓
utilities (streamHelpers, qualityMapping)
    ↓
New State
    ↓
React Re-render
```

### Streaming Flow

```
sendChat() called
    ↓
handleStreamEvent() registered
    ↓
Stream events arrive
    ↓
dispatch({ type: 'STREAM_*', payload: ... })
    ↓
reducer.ts → streamHelpers.apply*()
    ↓
Messages array updated
    ↓
UI re-renders with new tokens
```

## Module Responsibilities

### types.ts
**Purpose:** Type definitions
**Exports:** ChatState, ChatAction, PendingState, ToolSpec
**Dependencies:** None (pure types)

### initialState.ts
**Purpose:** Default values and constants
**Exports:** initialState, availableTools
**Dependencies:** types.ts

### reducer.ts
**Purpose:** State transitions
**Exports:** chatReducer function
**Dependencies:** types.ts, utils/qualityMapping.ts, utils/streamHelpers.ts

### utils/qualityMapping.ts
**Purpose:** Quality level → settings mapping
**Exports:** qualityLevelMap, getQualityMapping()
**Dependencies:** ../../../components/ui/QualitySlider (type only)

### utils/streamHelpers.ts
**Purpose:** Stream event processing
**Exports:** 5 helper functions
**Dependencies:** None (pure functions)

### utils/chatConfigBuilder.ts
**Purpose:** Build chat request config
**Exports:** buildChatConfig(), related types
**Dependencies:** ../../../lib/chat (type only)

### index.ts
**Purpose:** Public API surface
**Exports:** Re-exports types and hook
**Dependencies:** types.ts, ../useChatState.ts

## State Shape

```typescript
ChatState {
  // Auth
  user: User | null
  isAuthenticated: boolean

  // UI
  status: 'idle' | 'streaming' | 'loading' | 'error'
  input: string
  images: ImageAttachment[]
  sidebarCollapsed: boolean
  rightSidebarCollapsed: boolean

  // Chat
  messages: ChatMessage[]
  conversationId: string | null
  currentConversationTitle: string | null
  previousResponseId: string | null

  // Settings
  model: string
  providerId: string | null
  modelOptions: ModelOption[]
  modelGroups: TabGroup[] | null
  modelToProvider: Record<string, string>
  modelCapabilities: Record<string, any>
  isLoadingModels: boolean
  useTools: boolean
  shouldStream: boolean
  reasoningEffort: string
  verbosity: string
  qualityLevel: QualityLevel
  systemPrompt: string
  inlineSystemPromptOverride: string
  activeSystemPromptId: string | null
  enabledTools: string[]

  // Conversations
  conversations: ConversationMeta[]
  nextCursor: string | null
  historyEnabled: boolean
  loadingConversations: boolean

  // Editing
  editingMessageId: string | null
  editingContent: string

  // Error
  error: string | null

  // Internal
  abort?: AbortController
}
```

## Action Categories

### Authentication (2 actions)
- SET_USER
- SET_AUTHENTICATED

### UI (2 actions)
- SET_INPUT
- SET_IMAGES

### Settings (12 actions)
- SET_MODEL
- SET_PROVIDER_ID
- SET_USE_TOOLS
- SET_SHOULD_STREAM
- SET_REASONING_EFFORT
- SET_VERBOSITY
- SET_QUALITY_LEVEL
- SET_SYSTEM_PROMPT
- SET_INLINE_SYSTEM_PROMPT_OVERRIDE
- SET_ACTIVE_SYSTEM_PROMPT_ID
- SET_ENABLED_TOOLS
- SET_MODEL_LIST
- SET_LOADING_MODELS

### Conversations (8 actions)
- SET_CONVERSATION_ID
- SET_CURRENT_CONVERSATION_TITLE
- LOAD_CONVERSATIONS_START
- LOAD_CONVERSATIONS_SUCCESS
- LOAD_CONVERSATIONS_ERROR
- SET_HISTORY_ENABLED
- ADD_CONVERSATION
- DELETE_CONVERSATION
- NEW_CHAT

### Streaming (9 actions)
- START_STREAMING
- REGENERATE_START
- STREAM_TOKEN
- STREAM_TOOL_CALL
- STREAM_TOOL_OUTPUT
- STREAM_USAGE
- STREAM_COMPLETE
- STREAM_ERROR
- STOP_STREAMING

### Messages (3 actions)
- CLEAR_MESSAGES
- SET_MESSAGES
- SYNC_ASSISTANT

### Editing (4 actions)
- START_EDIT
- UPDATE_EDIT_CONTENT
- CANCEL_EDIT
- SAVE_EDIT_SUCCESS

### Errors (1 action)
- CLEAR_ERROR

### Sidebars (4 actions)
- TOGGLE_SIDEBAR
- SET_SIDEBAR_COLLAPSED
- TOGGLE_RIGHT_SIDEBAR
- SET_RIGHT_SIDEBAR_COLLAPSED

**Total:** 45 action types

## Future Architecture (Post Phase 2-4)

```
useChatState/
├── index.ts
├── types.ts
├── initialState.ts
├── reducer/
│   ├── index.ts              # Combined reducer
│   ├── authReducer.ts
│   ├── chatReducer.ts
│   ├── conversationReducer.ts
│   ├── uiReducer.ts
│   └── settingsReducer.ts
├── actions/
│   ├── authActions.ts
│   ├── chatActions.ts
│   ├── conversationActions.ts
│   ├── editActions.ts
│   ├── modelActions.ts
│   └── uiActions.ts
├── hooks/
│   ├── useStreamHandlers.ts
│   ├── useModelLoader.ts
│   ├── useConversationLoader.ts
│   └── useRefs.ts
└── utils/
    ├── qualityMapping.ts
    ├── streamHelpers.ts
    └── chatConfigBuilder.ts
```

This architecture enables:
- Better code organization
- Easier testing
- Clear responsibilities
- Simpler debugging
- Team collaboration without conflicts
