# Frontend Code Flow Documentation

This document explains the architecture and data flow of the ChatForge frontend application.

## Overview

ChatForge's frontend is a Next.js application that provides a modern, real-time chat interface with support for multiple AI models, tool orchestration, image handling, and conversation persistence. The architecture follows a **simplified state management pattern** using React hooks without complex reducer patterns.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Next.js App Router                      │
│                       (app/page.tsx)                         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ├──► ProtectedRoute (Auth Guard)
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    ChatV2 (Main Container)                   │
│  - Layout management                                         │
│  - Sidebar state                                             │
│  - URL synchronization                                       │
│  - Event coordination                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   ┌────────┐  ┌──────────┐  ┌──────────┐
   │Sidebar │  │ Messages │  │  Input   │
   │        │  │   List   │  │          │
   └────────┘  └──────────┘  └──────────┘
                     │
                     ▼
              ┌──────────────┐
              │   useChat    │
              │    Hook      │
              └──────┬───────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   ┌────────┐  ┌─────────┐  ┌──────────┐
   │  API   │  │Streaming│  │  HTTP    │
   │ Layer  │  │ Parser  │  │ Client   │
   └────────┘  └─────────┘  └──────────┘
```

## Entry Point: app/page.tsx

The application starts at `app/page.tsx`, which serves as the root route:

```typescript
function Home() {
  return (
    <ProtectedRoute requireAuth fallback={<AuthGate />}>
      <ChatV2 />
    </ProtectedRoute>
  );
}
```

**Key responsibilities:**
- Authentication check via `ProtectedRoute`
- Renders either the authentication gate or the main chat interface

## Core Components

### 1. ChatV2 (components/ChatV2.tsx)

The main container component that orchestrates the entire application.

**State Management:**
- Consumes `useChat` hook for all chat-related state
- Manages UI-specific state (sidebar visibility, settings modals)
- Handles resizable sidebars with drag functionality

**Key Features:**
- **URL Synchronization**: Keeps conversation ID in sync with browser URL
- **Keyboard Shortcuts**: Ctrl/Cmd+\ for sidebar toggling
- **Message Editing**: Coordinates local edits vs. persisted edits
- **Scroll Management**: Dynamic scroll buttons and auto-scroll behavior

**Event Flow:**
```
User Action → ChatV2 Handler → useChat Action → API Call → State Update → UI Re-render
```

### 2. useChat Hook (hooks/useChat.ts)

The **central state management hub** - a custom hook that manages all chat functionality using `useState` and `useCallback`.

**Philosophy:**
- Direct state manipulation without complex reducers
- Refs for performance optimization (avoid stale closures)
- Simplified API surface for consumers

**State Categories:**

#### Messages & Conversations
```typescript
const [messages, setMessages] = useState<Message[]>([]);
const [conversationId, setConversationId] = useState<string | null>(null);
const [conversations, setConversations] = useState<Conversation[]>([]);
```

#### Model & Provider
```typescript
const [model, setModel] = useState<string>('gpt-4');
const [providerId, setProviderId] = useState<string | null>(null);
const [modelCapabilities, setModelCapabilities] = useState<any>(null);
```

#### Tools & Configuration
```typescript
const [useTools, setUseTools] = useState(true);
const [enabledTools, setEnabledTools] = useState<string[]>([]);
const [shouldStream, setShouldStream] = useState(true);
const [qualityLevel, setQualityLevel] = useState<QualityLevel>('unset');
```

#### Model Comparison Mode
```typescript
const [compareModels, setCompareModels] = useState<string[]>([]);
const [linkedConversations, setLinkedConversations] = useState<Record<string, string>>({});
const [comparisonResults, setComparisonResults] = useState<Record<string, Message[]>>({});
```

#### Model & Provider Loading
```typescript
const [isLoadingModels, setIsLoadingModels] = useState(true);
const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
const [modelToProvider, setModelToProvider] = useState<Record<string, string>>({});
const [currentConversationTitle, setCurrentConversationTitle] = useState<string>('');
const [activeSystemPromptId, setActiveSystemPromptId] = useState<string | null>(null);
```

#### UI State
```typescript
const [input, setInput] = useState('');
const [status, setStatus] = useState<Status>('idle');
const [pending, setPending] = useState<PendingState>({...});
const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
```

**Key Actions:**

1. **sendMessage**: Sends a user message to the backend
   - Creates placeholder assistant message
   - Initiates streaming via API
   - Handles token-by-token updates via callbacks
   - Updates conversation metadata

2. **selectConversation**: Loads a conversation from history
   - Fetches messages from backend
   - Applies conversation settings (model, tools, quality)
   - Merges tool outputs into assistant messages

3. **regenerate**: Retries the last assistant response
   - Keeps messages up to the user message
   - Re-sends with same settings

4. **stopStreaming**: Aborts ongoing stream via AbortController

5. **retryComparisonModel**: Retries a specific model in comparison mode
   - Re-sends message to a single model
   - Updates only that model's results in `comparisonResults`

### 3. MessageList (components/MessageList.tsx)

Displays the conversation history with optimized rendering.

**Key Features:**
- **Memoized Messages**: Individual message components use `React.memo` to prevent unnecessary re-renders
- **Tool Call Rendering**: Displays tool calls inline with text using segments
- **Position-Based Ordering**: Uses `textOffset` to show tool calls at the correct position in streaming
- **Dynamic Padding**: Adjusts bottom padding based on viewport and streaming state
- **Scroll Management**: Tracks scroll position and shows scroll buttons

**Message Rendering Logic:**
```typescript
// Build segments from assistant messages
function buildAssistantSegments(message: ChatMessage): AssistantSegment[] {
  // Segments can be:
  // - { kind: 'text', text: string }
  // - { kind: 'tool_call', toolCall: any, outputs: ToolOutput[] }

  // For streaming (has textOffset): position-based insertion
  // For loaded conversations: tools first, then content
}
```

**Tool Output Display:**
- Collapsible tool call blocks
- Shows input arguments and output results
- Summary view when collapsed
- Detailed view with JSON formatting when expanded

**Conversation Forking:**
- `onFork?: (messageId: string, modelId: string)` callback prop
- Fork icon appears in message toolbar
- Creates a new linked conversation at the fork point
- Preserves message history up to fork point

### 4. MessageInput (components/MessageInput.tsx)

The input area with controls for sending messages.

**Features:**
- Auto-growing textarea (up to 200px)
- Image upload via drag-and-drop, paste, or file picker
- Audio upload for voice messages
- File upload for code files
- Tool selection dropdown
- Reasoning/quality controls for thinking models
- Stream toggle

**Audio Upload Support:**
```typescript
interface AudioAttachment {
  id: string;
  file: File;
  url: string;              // Blob URL for preview
  name: string;
  size: number;
  type: string;
  format?: string;          // Inferred audio format (mp3, wav, etc.)
}

const [audios, setAudios] = useState<AudioAttachment[]>([]);
```
- Audio files processed for base64 encoding
- Format inference from file type
- `AudioPreview` component (`components/ui/AudioPreview.tsx`) for playback preview
- Audio content sent as input_audio content type

**File Upload Support:**
```typescript
const [files, setFiles] = useState<FileAttachment[]>([]);
```
- Text file content prepended to message
- `FileContentPreview` component for file preview
- Supports 30+ file types (code files, markdown, etc.)
- Max 5MB per file, 3 files per message

**Image Handling Flow:**
1. User selects/pastes/drops images
2. Images uploaded via `images.uploadImages()`
3. Upload progress tracked in state
4. Uploaded images added to input state
5. On send, images included in message content

**Tool Selection:**
- Loads available tools from backend
- Maintains local selected state
- Quick toggle for web search (enables multiple search tools)
- Filter and bulk select/deselect

### 5. API Layer (lib/api.ts)

Centralized API client that handles all backend communication.

**Modules:**

#### Auth API
```typescript
auth.register(email, password)
auth.login(email, password)
auth.logout()
auth.getProfile()
auth.verifySession()
```

**Token Management:**
- Stores access token and refresh token in localStorage
- Automatic token refresh on 401 errors
- Request queueing during refresh

#### Chat API
```typescript
chat.sendMessage({
  messages, model, providerId,
  stream, providerStream,
  conversationId, toolsEnabled, tools,
  qualityLevel, reasoning,
  systemPrompt, activeSystemPromptId,
  onToken, onEvent
})
```

**Streaming Response Handling:**
- Always uses Server-Sent Events (SSE) for real-time updates
- Processes chunks via `SSEParser`
- Fires callbacks for tokens, tool calls, tool outputs, usage stats
- Handles reasoning content (wraps in `<thinking>` tags)

#### Conversations API
```typescript
conversations.create(options)
conversations.list(params)
conversations.get(id, params)
conversations.delete(id)
conversations.editMessage(conversationId, messageId, content)
```

**Caching:**
- In-memory cache with TTL (5 minutes)
- Cache invalidation on mutations
- Prefix-based cache deletion

#### Images & Files API
```typescript
images.uploadImages(files, onProgress)
images.validateImages(files, config)
images.createPreviewUrl(file)
images.revokePreviewUrl(url)

files.uploadFiles(files, onProgress)
files.validateFiles(files, config)
```

#### Tools & Providers API
```typescript
tools.getToolSpecs()
providers.getDefaultProviderId()
```

### 6. HTTP Client (lib/http.ts)

Authenticated HTTP client with automatic token refresh.

**Key Features:**

#### Automatic Token Refresh
```typescript
// On 401 response:
1. Mark refresh in progress
2. Queue incoming requests
3. Call refresh token endpoint
4. Update access token
5. Retry original request
6. Process queued requests
```

#### Request Queueing
- Prevents multiple simultaneous refresh attempts
- Queues requests during refresh
- Resolves all queued requests after successful refresh

#### Error Handling
- Detects streaming not supported errors
- Wraps errors in HttpError class
- Clears auth state on refresh failure

### 7. Streaming Parser (lib/streaming.ts)

Parses Server-Sent Events from the backend.

```typescript
class SSEParser {
  parse(chunk: string): SSEEvent[] {
    // Buffers incoming chunks
    // Extracts complete events
    // Parses JSON data
    // Returns array of events
  }
}
```

**Event Types:**
- `data`: Streaming chunk with message content, tool calls, usage
- `done`: End of stream marker

### 8. Model Comparison Mode

Enables side-by-side comparison of responses from multiple models.

**State Management (in useChat):**
```typescript
const [compareModels, setCompareModels] = useState<string[]>([]);
const [linkedConversations, setLinkedConversations] = useState<Record<string, string>>({});
const [comparisonResults, setComparisonResults] = useState<Record<string, Message[]>>({});
```

**CompareSelector Component (`components/ui/CompareSelector.tsx`):**
- Multi-model selection interface
- Uses same base component pattern as `ModelSelector`
- Displays selected models as tags
- Enables/disables comparison mode

**Comparison Flow:**
1. User selects multiple models via `CompareSelector`
2. `sendMessage` sends parallel requests to each model
3. Results stored in `comparisonResults` keyed by model ID
4. `linkedConversations` tracks separate conversation IDs per model
5. UI renders side-by-side columns with isolated histories
6. `retryComparisonModel` allows retrying individual model responses

### 9. System Prompt Management

**RightSidebar Component (`components/RightSidebar.tsx`):**
- Displays and manages system prompts
- Toggle visibility via UI controls
- Shows prompt editor interface

**Prompt Editor (`app/components/promptManager/`):**
- Full CRUD operations for system prompts
- Built-in prompts vs custom user prompts
- Prompt selection and activation

**useSystemPrompts Hook (`hooks/useSystemPrompts.ts`):**
```typescript
const {
  prompts,              // List of all prompts
  activePrompt,         // Currently selected prompt
  isLoading,            // Loading state
  createPrompt,         // Create new prompt
  updatePrompt,         // Update existing prompt
  deletePrompt,         // Delete prompt
  setActivePrompt,      // Select a prompt
} = useSystemPrompts();
```

**Integration with Chat:**
- `activeSystemPromptId` state in useChat
- System prompt sent with each message request
- Prompt restored when loading conversations

### 10. Theme Support

**ThemeContext (`contexts/ThemeContext.tsx`):**
```typescript
type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';  // Actual theme after system resolution
}

const ThemeProvider: React.FC<{ children: React.ReactNode }>;
```

**useTheme Hook:**
```typescript
const { theme, setTheme, resolvedTheme } = useTheme();
```

**Features:**
- Persists preference to localStorage
- Respects system color scheme preference
- Applies theme class to document root
- Components use CSS variables for theming

### 11. Electron Desktop App Support

**Electron Utilities (`lib/electron.ts`):**
```typescript
// Check if running in Electron
export const isElectron = (): boolean;

// Get API base URL (resolved via IPC)
export const getApiBaseUrl = (): Promise<string>;

// IPC communication helpers
export const invokeMain = <T>(channel: string, ...args: any[]): Promise<T>;
```

**Auto-Login in AuthContext:**
- Detects Electron environment
- Retrieves stored credentials from Electron main process
- Automatic session restoration on app launch

**API Base URL Resolution:**
- In browser: Uses relative URLs or environment variable
- In Electron: Resolves via IPC to main process
- Supports local development and production builds

**Electron Main Process (`electron/main.js`):**
- Native window management
- IPC handlers for secure credential storage
- Auto-updater integration

### 12. User Settings

**User Settings Utilities (`lib/userSettings.ts`):**
```typescript
interface UserSettings {
  tavilyApiKey?: string;
  exaApiKey?: string;
  searxngUrl?: string;
  maxToolIterations?: number;
}

export const getUserSettings = (): Promise<UserSettings>;
export const updateUserSettings = (settings: Partial<UserSettings>): Promise<void>;
```

**Per-User API Key Storage:**
- Tavily search API key
- Exa search API key
- SearXNG instance URL
- Stored securely on backend, scoped to user

**Settings UI (`components/SettingsModal.tsx`):**
- API key input fields
- Max tool iterations configuration
- Validation and save functionality

### 13. Additional Hooks

**useStreamingScroll (`hooks/useStreamingScroll.ts`):**
```typescript
const {
  scrollRef,            // Ref for scroll container
  isAtBottom,           // Whether scrolled to bottom
  scrollToBottom,       // Function to scroll to bottom
  handleScroll,         // Scroll event handler
} = useStreamingScroll({ isStreaming, messages });
```
- Manages auto-scroll during streaming
- Shows/hides scroll-to-bottom button
- Preserves scroll position when user scrolls up

**useIsMobile (`hooks/useIsMobile.ts`):**
```typescript
const isMobile = useIsMobile();
```
- Detects mobile viewport
- Uses matchMedia for responsive detection
- Updates on viewport resize

**useSecureImageUrl (`hooks/useSecureImageUrl.ts`):**
```typescript
const secureUrl = useSecureImageUrl(imageUrl, accessToken);
```
- Generates secure URLs for image access
- Handles token expiration and refresh
- Used by `ImagePreview` component

## Data Flow Patterns

### 1. Sending a Message

```
┌──────────────┐
│ MessageInput │
└──────┬───────┘
       │ User types & clicks Send
       ▼
┌──────────────┐
│   useChat    │  1. Clear input immediately
│ .sendMessage │  2. Create user message
└──────┬───────┘  3. Create placeholder assistant message
       │
       ▼
┌──────────────┐
│  chat.api    │  4. POST to /v1/chat/completions
└──────┬───────┘  5. Request SSE streaming
       │
       ▼
┌──────────────┐
│ SSE Stream   │  6. Parse events
└──────┬───────┘  7. Fire onToken / onEvent callbacks
       │
       ▼
┌──────────────┐
│   useChat    │  8. Update assistant message content
└──────┬───────┘  9. Update tool calls & outputs
       │           10. Update usage stats
       ▼
┌──────────────┐
│ MessageList  │  11. Re-render with new content
└──────────────┘
```

**Token-by-Token Updates:**
- Backend sends SSE events with content chunks
- Frontend parses each event
- `onToken` callback appends to message content
- React state update triggers re-render

**Tool Execution Flow:**
- Backend sends `tool_call` event with tool details
- Frontend adds tool call to assistant message
- Backend executes tool (server-side)
- Backend sends `tool_output` event with results
- Frontend adds output to assistant message
- All visible in real-time during streaming

### 2. Loading a Conversation

```
┌──────────────┐
│  ChatSidebar │  User clicks conversation
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   useChat    │  1. Call selectConversation(id)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│conversations │  2. GET /v1/conversations/:id
│    .api      │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   useChat    │  3. Convert backend messages to frontend format
└──────┬───────┘  4. Merge tool outputs into assistant messages
       │           5. Prepend reasoning to content if present
       │           6. Apply conversation settings (model, tools, quality)
       ▼
┌──────────────┐
│ MessageList  │  7. Display conversation history
└──────────────┘
```

**Settings Restoration:**
- Model and provider loaded from conversation metadata
- Enabled tools restored from `active_tools`
- Quality level and streaming preferences applied
- System prompt restored if present

### 3. Authentication Flow

```
┌──────────────┐
│ ProtectedRoute│ Check if user is authenticated
└──────┬───────┘
       │
   ┌───┴───┐
   │ Yes   │ No
   │       │
   ▼       ▼
┌─────┐ ┌──────────┐
│Chat │ │ AuthGate │
└─────┘ └──────────┘
           │
           │ User logs in
           ▼
      ┌──────────┐
      │auth.login│  POST /v1/auth/login
      └────┬─────┘
           │
           ▼
      ┌──────────┐
      │ Storage  │  Store access token & refresh token
      └────┬─────┘
           │
           ▼
      ┌──────────┐
      │Redirect  │  Navigate to chat
      └──────────┘
```

**Token Refresh on 401:**
```
Request → 401 Error → httpClient detects → Call refresh endpoint
  ↓
Queue new requests
  ↓
Refresh succeeds → Update token → Retry original → Process queue
  ↓
Refresh fails → Clear tokens → Redirect to login
```

### 4. Image Upload Flow

```
┌──────────────┐
│ MessageInput │  User selects/pastes/drops image
└──────┬───────┘
       │
       ▼
┌──────────────┐
│handleImageFiles│ Validate & upload
└──────┬───────┘
       │
       ▼
┌──────────────┐
│images.upload │  POST /v1/images/upload (FormData)
│   Images     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Backend    │  Save to disk, generate secure URLs
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ MessageInput │  Add to images state (ImageAttachment[])
└──────┬───────┘
       │
       ▼ User clicks Send
┌──────────────┐
│   useChat    │  Convert to MessageContent format
│ .sendMessage │  [{ type: 'text', text }, { type: 'image_url', image_url }]
└──────────────┘
```

**Image Attachment Structure:**
```typescript
interface ImageAttachment {
  id: string;
  file: File;
  url: string;              // Display URL (could be blob: or server URL)
  downloadUrl?: string;     // Backend download URL
  accessToken?: string;     // Secure access token
  expiresAt?: string;       // Token expiration
  name: string;
  size: number;
  type: string;
}
```

## State Management Philosophy

### Why Not Redux/Zustand?

The application uses **direct state management** with React hooks because:

1. **Simplicity**: Chat state is naturally hierarchical, fits React's component tree
2. **Performance**: Refs prevent stale closures, memoization prevents excess renders
3. **Debugging**: Direct state is easier to trace than action dispatchers
4. **Type Safety**: TypeScript ensures type safety without action types

### useChat Hook Design

**State + Refs Pattern:**
```typescript
// State for UI rendering
const [model, setModel] = useState('gpt-4');

// Ref for async operations (avoid stale closures)
const modelRef = useRef('gpt-4');

// Setter updates both
const setModelWrapper = useCallback((m: string) => {
  setModel(m);
  modelRef.current = m;
}, []);
```

This ensures:
- UI renders with latest state
- Async callbacks (like `sendMessage`) use latest values via refs
- No need for complex dependency arrays

### Optimistic Updates

The app uses **optimistic UI updates**:
- User message added immediately to UI
- Placeholder assistant message shown while streaming
- Streaming content appends in real-time
- Backend response confirms and updates conversation ID

## Component Communication

### Props-Based Communication
```
ChatV2
  ├─ useChat hook (source of truth)
  │
  ├─ ChatHeader
  │   └─ receives: model, onModelChange, onProviderChange
  │
  ├─ MessageList
  │   └─ receives: messages, onEditMessage, onRetryMessage
  │
  └─ MessageInput
      └─ receives: input, onInputChange, onSend, images, onImagesChange
```

### Event Bubbling Pattern
- Child components fire callbacks
- Callbacks defined in ChatV2 or useChat
- State updated at the source
- Changes propagate down via props

## Performance Optimizations

### 1. Message Memoization
```typescript
const Message = React.memo(MessageComponent, (prev, next) => {
  // Only re-render if content, tool_calls, or streaming state changed
  return prev.message.content === next.message.content &&
         prev.isStreaming === next.isStreaming;
});
```

### 2. Ref-Based Token Stats
```typescript
// Avoid re-renders on every token
const tokenStatsRef = useRef({ count: 0, startTime: Date.now() });

// Update ref without state change
tokenStatsRef.current.count += 1;

// Periodic state sync for UI updates
setPending({ tokenStats: tokenStatsRef.current });
```

### 3. Debounced Textarea Resize
```typescript
// Auto-grow textarea only on input, not on every render
useEffect(() => {
  const el = inputRef.current;
  el.style.height = 'auto';
  el.style.height = `${Math.min(200, el.scrollHeight)}px`;
}, [input]);
```

### 4. API Response Caching
```typescript
// Cache conversation list for 5 minutes
const conversationListCache = new Cache<ConversationsList>(5 * 60 * 1000);

// Return cached data if available
const cached = conversationListCache.get(cacheKey);
if (cached) return cached;
```

## Error Handling

### API Errors
```typescript
try {
  await chat.sendMessage(...);
} catch (err) {
  if (err instanceof StreamingNotSupportedError) {
    // Retry with streaming disabled
    providerStreamRef.current = false;
    await sendMessage(..., { retried: true });
  } else if (err instanceof APIError) {
    // Format upstream error
    setError(formatUpstreamError(err));
  } else {
    // Generic error
    setError('Failed to send message');
  }
}
```

### Streaming Errors
- **Abort handling**: User can stop streaming via AbortController
- **Retry logic**: Auto-retry once if streaming not supported
- **Error display**: Show error message in MessageList

### Authentication Errors
- **401 detection**: httpClient automatically tries token refresh
- **Refresh failure**: Clear tokens and redirect to login
- **Request queueing**: Queue requests during refresh, retry after

## Key Conventions

### 1. Message Content Types

Messages support multiple content types:
```typescript
type MessageContent =
  | string                                    // Simple text
  | TextContent[]                             // Array of content blocks
  | (TextContent | ImageContent)[]            // Mixed text and images

interface TextContent {
  type: 'text';
  text: string;
}

interface ImageContent {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}
```

### 2. Tool Call Structure
```typescript
interface ToolCall {
  id: string;
  type: 'function';
  index?: number;
  textOffset?: number;     // Position in content where tool was called
  function: {
    name: string;
    arguments: string;     // JSON string
  };
}

interface ToolOutput {
  tool_call_id: string;
  name?: string;
  output: any;
  status?: 'success' | 'error';
}
```

### 3. Provider-Qualified Model IDs

Models are identified by provider-qualified IDs:
```
"openai::gpt-4"
"anthropic::claude-3-5-sonnet-20241022"
```

This allows multiple providers to offer the same model name without conflicts.

### 4. Reasoning Controls

Models that support reasoning (like o1, o3, deepseek-r1) can have reasoning effort controlled:
```typescript
qualityLevel: 'unset' | 'minimal' | 'low' | 'medium' | 'high'
```

This maps to the `reasoning_effort` parameter in the API request.

### 5. Conversation Settings Snapshots

Each conversation stores complete settings:
- Model and provider
- Enabled tools
- Streaming preference
- Quality level
- System prompt

When loading a conversation, these settings are restored to reproduce the exact configuration.

## Testing Considerations

### Component Testing
- **MessageList**: Test message rendering, tool display, editing
- **MessageInput**: Test input handling, image upload, tool selection
- **useChat**: Test message sending, streaming, conversation loading

### Integration Testing
- **Auth flow**: Login → Token storage → API calls → Logout
- **Message flow**: Type → Send → Stream → Display
- **Conversation flow**: Create → Load → Edit → Delete

### E2E Testing
- **Full chat session**: Login → Select model → Send messages → View history
- **Tool usage**: Enable tools → Send message → View tool execution
- **Image handling**: Upload image → Send → Display in conversation

## File Organization

```
frontend/
├── app/
│   ├── layout.tsx                 # Root layout with providers
│   ├── page.tsx                   # Entry point (Home → ChatV2)
│   └── components/
│       └── promptManager/         # System prompt management UI
│           ├── PromptEditor.tsx   # Prompt editing interface
│           ├── PromptList.tsx     # List of prompts
│           └── index.ts           # Public exports
│
├── components/
│   ├── ChatV2.tsx                 # Main container
│   ├── MessageList.tsx            # Message display
│   ├── MessageInput.tsx           # Input area
│   ├── ChatHeader.tsx             # Model selector, settings
│   ├── ChatSidebar.tsx            # Conversation history
│   ├── RightSidebar.tsx           # System prompts sidebar
│   ├── SettingsModal.tsx          # Provider configuration
│   ├── Markdown.tsx               # Markdown rendering
│   ├── auth/                      # Authentication components
│   │   ├── AuthModal.tsx
│   │   ├── LoginForm.tsx
│   │   ├── RegisterForm.tsx
│   │   └── ProtectedRoute.tsx
│   └── ui/                        # Reusable UI primitives
│       ├── ImagePreview.tsx       # Image preview and upload zone
│       ├── AudioPreview.tsx       # Audio file preview and playback
│       ├── FilePreview.tsx        # File preview component
│       ├── FileContentPreview.tsx # File content display
│       ├── ModelSelector.tsx      # Single model selection
│       ├── CompareSelector.tsx    # Multi-model comparison selection
│       ├── QualitySlider.tsx      # Reasoning effort control
│       └── Toggle.tsx             # Toggle switch component
│
├── contexts/
│   └── ThemeContext.tsx           # Dark/light/system theme management
│
├── hooks/
│   ├── useChat.ts                 # Central state management
│   ├── useSystemPrompts.ts        # System prompt management
│   ├── useSecureImageUrl.ts       # Secure image URL handling
│   ├── useStreamingScroll.ts      # Scroll management during streaming
│   └── useIsMobile.ts             # Mobile viewport detection
│
├── lib/
│   ├── api.ts                     # Centralized API client
│   ├── http.ts                    # HTTP client with auth
│   ├── streaming.ts               # SSE parser
│   ├── storage.ts                 # LocalStorage wrapper
│   ├── types.ts                   # Type definitions
│   ├── contentUtils.ts            # Content manipulation
│   ├── modelCapabilities.ts       # Model capability detection
│   ├── electron.ts                # Electron environment utilities
│   ├── userSettings.ts            # User settings management
│   └── index.ts                   # Public exports
│
└── styles/                        # Global styles
```

## Summary

The ChatForge frontend follows these key principles:

1. **Simplified State Management**: Custom hooks with direct state manipulation
2. **Real-Time Streaming**: SSE-based streaming with token-by-token updates
3. **Performance**: Memoization, refs, and selective re-renders
4. **Type Safety**: Comprehensive TypeScript types throughout
5. **User Experience**: Optimistic updates, auto-scroll, keyboard shortcuts
6. **Error Handling**: Automatic token refresh, retry logic, user-friendly errors
7. **Modularity**: Clear separation between UI, state, and API layers
8. **Multi-Modal Support**: Images, audio, and file uploads with previews
9. **Model Comparison**: Side-by-side comparison of multiple model responses
10. **Cross-Platform**: Browser and Electron desktop app support
11. **Theming**: Dark/light/system theme support with context-based management
12. **System Prompts**: Built-in and custom prompt management

The architecture prioritizes **developer experience** (easy to understand and modify) and **user experience** (fast, responsive, real-time updates) while maintaining production reliability and cross-platform compatibility.
