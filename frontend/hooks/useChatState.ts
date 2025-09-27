import React, { useReducer, useCallback, useRef, useEffect } from 'react';
import type { ChatMessage, Role, ConversationMeta } from '../lib/chat';
import type { Group as TabGroup, Option as ModelOption } from '../components/ui/TabbedSelect';
import { sendChat, getConversationApi, listConversationsApi, deleteConversationApi, editMessageApi } from '../lib/chat';
import type { QualityLevel } from '../components/ui/QualitySlider';
import type { User } from '../lib/auth/api';
import { useAuth } from '../contexts/AuthContext';

export interface PendingState {
  abort?: AbortController;
  streaming: boolean;
  error?: string;
}

// Unified state structure
export interface ChatState {
  // Authentication State
  user: User | null;
  isAuthenticated: boolean;

  // UI State
  status: 'idle' | 'streaming' | 'loading' | 'error';
  input: string;

  // Chat State
  messages: ChatMessage[];
  conversationId: string | null;
  previousResponseId: string | null;
  // ...existing code...

  // Settings
  model: string;
  providerId: string | null;
  // Model listing fetched from backend providers
  modelOptions: ModelOption[];
  modelGroups: TabGroup[] | null;
  modelToProvider: Record<string, string>;
  useTools: boolean;
  shouldStream: boolean;
  reasoningEffort: string;
  verbosity: string;
  qualityLevel: QualityLevel;
  // System prompt for the current session (legacy support)
  systemPrompt: string;
  // Inline system prompt override (from prompt manager)
  inlineSystemPromptOverride: string;
  // Active system prompt ID from loaded conversation
  activeSystemPromptId: string | null;
  // Per-tool enablement (list of tool names). Empty array means no explicit selection.
  enabledTools: string[];

  // Conversations
  conversations: ConversationMeta[];
  nextCursor: string | null;
  historyEnabled: boolean;
  loadingConversations: boolean;
  sidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;

  // Message Editing
  editingMessageId: string | null;
  editingContent: string;

  // Error handling
  error: string | null;

  // Internal state
  abort?: AbortController;
}

// Action types
export type ChatAction =
  // Authentication Actions
  | { type: 'SET_USER'; payload: User | null }
  | { type: 'SET_AUTHENTICATED'; payload: boolean }

  // Existing Actions
  | { type: 'SET_INPUT'; payload: string }
  | { type: 'SET_MODEL'; payload: string }
  | { type: 'SET_PROVIDER_ID'; payload: string | null }
  | { type: 'SET_USE_TOOLS'; payload: boolean }
  | { type: 'SET_SHOULD_STREAM'; payload: boolean }
  | { type: 'SET_REASONING_EFFORT'; payload: string }
  | { type: 'SET_VERBOSITY'; payload: string }
  | { type: 'SET_QUALITY_LEVEL'; payload: QualityLevel }
  | { type: 'SET_SYSTEM_PROMPT'; payload: string }
  | { type: 'SET_INLINE_SYSTEM_PROMPT_OVERRIDE'; payload: string }
  | { type: 'SET_ACTIVE_SYSTEM_PROMPT_ID'; payload: string | null }
  | { type: 'SET_ENABLED_TOOLS'; payload: string[] }
  | { type: 'SET_CONVERSATION_ID'; payload: string | null }
  | { type: 'START_STREAMING'; payload: { abort: AbortController; userMessage: ChatMessage; assistantMessage: ChatMessage } }
  | { type: 'REGENERATE_START'; payload: { abort: AbortController; baseMessages: ChatMessage[]; assistantMessage: ChatMessage } }
  | { type: 'STREAM_TOKEN'; payload: { messageId: string; token: string } }
  | { type: 'STREAM_TOOL_CALL'; payload: { messageId: string; toolCall: any } }
  | { type: 'STREAM_TOOL_OUTPUT'; payload: { messageId: string; toolOutput: any } }
  | { type: 'STREAM_COMPLETE'; payload: { responseId?: string } }
  | { type: 'STREAM_ERROR'; payload: string }
  | { type: 'STOP_STREAMING' }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'SET_MESSAGES'; payload: ChatMessage[] }
  | { type: 'LOAD_CONVERSATIONS_START' }
  | { type: 'LOAD_CONVERSATIONS_SUCCESS'; payload: { conversations: ConversationMeta[]; nextCursor: string | null; replace?: boolean } }
  | { type: 'LOAD_CONVERSATIONS_ERROR' }
  | { type: 'SET_HISTORY_ENABLED'; payload: boolean }
  | { type: 'ADD_CONVERSATION'; payload: ConversationMeta }
  | { type: 'DELETE_CONVERSATION'; payload: string }
  | { type: 'START_EDIT'; payload: { messageId: string; content: string } }
  | { type: 'UPDATE_EDIT_CONTENT'; payload: string }
  | { type: 'CANCEL_EDIT' }
  | { type: 'SAVE_EDIT_SUCCESS'; payload: { messageId: string; content: string; baseMessages: ChatMessage[] } }
  | { type: 'CLEAR_ERROR' }
  | { type: 'NEW_CHAT' }
  | { type: 'SYNC_ASSISTANT'; payload: ChatMessage }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SIDEBAR_COLLAPSED'; payload: boolean }
  | { type: 'TOGGLE_RIGHT_SIDEBAR' }
  | { type: 'SET_RIGHT_SIDEBAR_COLLAPSED'; payload: boolean }
  | { type: 'SET_MODEL_LIST'; payload: { groups: TabGroup[] | null; options: ModelOption[]; modelToProvider: Record<string, string> } };

const initialState: ChatState = {
  // Authentication State
  user: null,
  isAuthenticated: false,

  status: 'idle',
  input: '',
  messages: [],
  conversationId: null,
  previousResponseId: null,
  model: 'gpt-4.1-mini',
  providerId: null,
  modelOptions: [],
  modelGroups: null,
  modelToProvider: {},
  useTools: true,
  shouldStream: true,
  reasoningEffort: 'medium',
  verbosity: 'medium',
  qualityLevel: 'balanced',
  systemPrompt: '',
  inlineSystemPromptOverride: '',
  activeSystemPromptId: null,
  enabledTools: [],
  conversations: [],
  nextCursor: null,
  historyEnabled: true,
  loadingConversations: false,
  sidebarCollapsed: false,
  rightSidebarCollapsed: false,
  editingMessageId: null,
  editingContent: '',
  error: null,
};

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    // Authentication Actions
    case 'SET_USER':
      return {
        ...state,
        user: action.payload,
        isAuthenticated: action.payload !== null
      };

    case 'SET_AUTHENTICATED':
      return { ...state, isAuthenticated: action.payload };

    // Existing Actions
    case 'SET_INPUT':
      return { ...state, input: action.payload };

    case 'SET_MODEL':
      return { ...state, model: action.payload };

    case 'SET_PROVIDER_ID':
      return { ...state, providerId: action.payload };

    case 'SET_USE_TOOLS':
      return { ...state, useTools: action.payload };

    case 'SET_SHOULD_STREAM':
      return { ...state, shouldStream: action.payload };

    case 'SET_REASONING_EFFORT':
      return { ...state, reasoningEffort: action.payload };

    case 'SET_VERBOSITY':
      return { ...state, verbosity: action.payload };


    case 'SET_QUALITY_LEVEL': {
      // Map quality level to derived settings for backward compatibility
      const map: Record<QualityLevel, { reasoningEffort: string; verbosity: string }> = {
        quick: { reasoningEffort: 'minimal', verbosity: 'low' },
        balanced: { reasoningEffort: 'medium', verbosity: 'medium' },
        thorough: { reasoningEffort: 'high', verbosity: 'high' },
      };
      const derived = map[action.payload];
      return {
        ...state,
        qualityLevel: action.payload,
        reasoningEffort: derived.reasoningEffort,
        verbosity: derived.verbosity,
      };
    }

    case 'SET_SYSTEM_PROMPT':
      return { ...state, systemPrompt: action.payload };

    case 'SET_INLINE_SYSTEM_PROMPT_OVERRIDE':
      return { ...state, inlineSystemPromptOverride: action.payload };

    case 'SET_ACTIVE_SYSTEM_PROMPT_ID':
      return { ...state, activeSystemPromptId: action.payload };

    case 'SET_ENABLED_TOOLS':
      return { ...state, enabledTools: action.payload };

    case 'SET_CONVERSATION_ID':
      return { ...state, conversationId: action.payload };

    case 'START_STREAMING':
      return {
        ...state,
        status: 'streaming',
        input: '', // Clear input immediately
        messages: [...state.messages, action.payload.userMessage, action.payload.assistantMessage],
        abort: action.payload.abort,
        error: null,
      };

    case 'REGENERATE_START':
      return {
        ...state,
        status: 'streaming',
        input: '',
        messages: [...action.payload.baseMessages, action.payload.assistantMessage],
        abort: action.payload.abort,
        error: null,
      };

    case 'STREAM_TOKEN':
      {
        let updated = false;
        const next = state.messages.map(m => {
          if (m.id === action.payload.messageId) {
            updated = true;
            return { ...m, content: m.content + action.payload.token };
          }
          return m;
        });
        if (!updated) {
          // Fallback: update the last assistant message if present
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === 'assistant') {
              next[i] = { ...next[i], content: next[i].content + action.payload.token } as any;
              break;
            }
          }
        }
        return { ...state, messages: next };
      }

    case 'STREAM_TOOL_CALL':
      {
        const upsertToolCall = (existing: any[] | undefined, incoming: any): any[] => {
          const out = Array.isArray(existing) ? [...existing] : [];
          const idx: number | undefined = typeof incoming.index === 'number' ? incoming.index : undefined;
          const id: string | undefined = incoming.id;

          const mergeArgs = (prevFn: any = {}, nextFn: any = {}) => {
            const prevArgs = typeof prevFn.arguments === 'string' ? prevFn.arguments : '';
            const nextArgs = typeof nextFn.arguments === 'string' ? nextFn.arguments : '';
            const mergedArgs = prevArgs && nextArgs && nextArgs.startsWith(prevArgs)
              ? nextArgs
              : (prevArgs + nextArgs);
            return {
              ...prevFn,
              ...nextFn,
              arguments: mergedArgs
            };
          };

          if (typeof idx === 'number') {
            while (out.length <= idx) out.push(undefined);
            const prev = out[idx] || {};
            out[idx] = {
              ...prev,
              ...incoming,
              function: mergeArgs(prev.function, incoming.function)
            };
            return out;
          }

          if (id) {
            const found = out.findIndex(tc => tc && tc.id === id);
            if (found >= 0) {
              const prev = out[found];
              out[found] = {
                ...prev,
                ...incoming,
                function: mergeArgs(prev.function, incoming.function)
              };
              return out;
            }
          }

          if (incoming?.function?.name) {
            const found = out.findIndex(tc => tc?.function?.name === incoming.function.name && !tc?.id);
            if (found >= 0) {
              const prev = out[found];
              out[found] = {
                ...prev,
                ...incoming,
                function: mergeArgs(prev.function, incoming.function)
              };
              return out;
            }
          }

          out.push(incoming);
          return out;
        };

        const next = state.messages.map(m => {
          if (m.id === action.payload.messageId) {
            const tool_calls = upsertToolCall((m as any).tool_calls, action.payload.toolCall);
            return { ...m, tool_calls } as any;
          }
          return m;
        });

        // Fallback in case message id not matched yet
        if (!next.some(m => m.id === action.payload.messageId)) {
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === 'assistant') {
              const m: any = next[i];
              const tool_calls = upsertToolCall(m.tool_calls, action.payload.toolCall);
              next[i] = { ...m, tool_calls };
              break;
            }
          }
        }

        return { ...state, messages: next };
      }

    case 'STREAM_TOOL_OUTPUT':
      {
        let updated = false;
        const next = state.messages.map(m => {
          if (m.id === action.payload.messageId) {
            updated = true;
            return { ...m, tool_outputs: [...(m.tool_outputs || []), action.payload.toolOutput] } as any;
          }
          return m;
        });
        if (!updated) {
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === 'assistant') {
              const to = [ ...((next[i] as any).tool_outputs || []), action.payload.toolOutput ];
              next[i] = { ...(next[i] as any), tool_outputs: to } as any;
              break;
            }
          }
        }
        return { ...state, messages: next };
      }

    case 'STREAM_COMPLETE':
      return {
        ...state,
        status: 'idle',
        abort: undefined,
      };

    case 'STREAM_ERROR':
      return {
        ...state,
        status: 'error',
        error: action.payload,
        abort: undefined,
      };

    case 'STOP_STREAMING':
      return {
        ...state,
        status: 'idle',
        abort: undefined,
      };

    case 'CLEAR_MESSAGES':
      return {
        ...state,
        messages: [],
        error: null,
      };

    case 'SET_MESSAGES':
      return { ...state, messages: action.payload };

    case 'LOAD_CONVERSATIONS_START':
      return { ...state, loadingConversations: true };

    case 'LOAD_CONVERSATIONS_SUCCESS':
      return {
        ...state,
        loadingConversations: false,
        conversations: action.payload.replace
          ? action.payload.conversations
          : [...state.conversations, ...action.payload.conversations],
        nextCursor: action.payload.nextCursor,
      };

    case 'LOAD_CONVERSATIONS_ERROR':
      return { ...state, loadingConversations: false };

    case 'SET_HISTORY_ENABLED':
      return { ...state, historyEnabled: action.payload };

    case 'ADD_CONVERSATION':
      return {
        ...state,
        conversations: [action.payload, ...state.conversations],
      };

    case 'DELETE_CONVERSATION':
      return {
        ...state,
        conversations: state.conversations.filter(c => c.id !== action.payload),
        conversationId: state.conversationId === action.payload ? null : state.conversationId,
      };

    case 'START_EDIT':
      return {
        ...state,
        editingMessageId: action.payload.messageId,
        editingContent: action.payload.content,
      };

    case 'UPDATE_EDIT_CONTENT':
      return { ...state, editingContent: action.payload };

    case 'CANCEL_EDIT':
      return { ...state, editingMessageId: null, editingContent: '' };

    case 'SAVE_EDIT_SUCCESS':
      return {
        ...state,
        messages: action.payload.baseMessages,
        editingMessageId: null,
        editingContent: '',
      };

    case 'SYNC_ASSISTANT':
      return {
        ...state,
        messages: state.messages.map(m => {
          if (m.id !== action.payload.id) return m;
          // Only sync content to avoid overwriting tool_calls/tool_outputs built during streaming
          const content = (action.payload as any).content ?? m.content;
          return { ...m, content };
        }),
      };

    case 'CLEAR_ERROR':
      return { ...state, error: null };

    case 'NEW_CHAT':
      return {
        ...state,
        messages: [],
        input: '',
        conversationId: null,
        previousResponseId: null,
        editingMessageId: null,
        editingContent: '',
        error: null,
      };

    case 'TOGGLE_SIDEBAR':
      {
        const newCollapsed = !state.sidebarCollapsed;
        // Save to localStorage
        try {
          if (typeof window !== 'undefined') {
            localStorage.setItem('sidebarCollapsed', String(newCollapsed));
          }
        } catch (e) {
          // ignore storage errors
        }
        return { ...state, sidebarCollapsed: newCollapsed };
      }

    case 'SET_SIDEBAR_COLLAPSED':
      return { ...state, sidebarCollapsed: action.payload };

    case 'TOGGLE_RIGHT_SIDEBAR':
      {
        const newCollapsed = !state.rightSidebarCollapsed;
        // Save to localStorage
        try {
          if (typeof window !== 'undefined') {
            localStorage.setItem('rightSidebarCollapsed', String(newCollapsed));
          }
        } catch (e) {
          // ignore storage errors
        }
        return { ...state, rightSidebarCollapsed: newCollapsed };
      }

    case 'SET_RIGHT_SIDEBAR_COLLAPSED':
      return { ...state, rightSidebarCollapsed: action.payload };

    case 'SET_MODEL_LIST':
      return {
        ...state,
        modelGroups: action.payload.groups,
        modelOptions: action.payload.options,
        modelToProvider: action.payload.modelToProvider || {}
      };

    default:
      return state;
  }
}

// Available tools used for quick lookups by name
import type { ToolSpec } from '../lib/chat';
const availableTools: Record<string, ToolSpec> = {
  get_time: {
    type: 'function',
    function: {
      name: 'get_time',
      description: 'Get the current local time of the server',
  parameters: { type: 'object', properties: {}, required: [] },
    }
  },
  web_search: {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Perform a web search for a given query',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' }
        },
        required: ['query']
      }
    }
  }
};

export function useChatState() {
  const { user, loading: authLoading } = useAuth();
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const assistantMsgRef = useRef<ChatMessage | null>(null);
  const inFlightRef = useRef<boolean>(false);

  // Sync authentication state from AuthContext
  useEffect(() => {
    if (!authLoading) {
      dispatch({ type: 'SET_USER', payload: user });
    }
  }, [user, authLoading]);

  // Load models/providers centrally (moved from ChatHeader local state)
  useEffect(() => {
    let cancelled = false;
    const apiBase = (process.env.NEXT_PUBLIC_API_BASE as string) ?? 'http://localhost:3001';

    async function loadProvidersAndModels() {
      try {
        const res = await fetch(`${apiBase}/v1/providers`);
        if (!res.ok) return;
        const json = await res.json();
        const providers: any[] = Array.isArray(json.providers) ? json.providers : [];
        const enabledProviders = providers.filter(p => p?.enabled);
        if (!enabledProviders.length) return;

        const results = await Promise.allSettled(
          enabledProviders.map(async (p) => {
            const r = await fetch(`${apiBase}/v1/providers/${encodeURIComponent(p.id)}/models`);
            if (!r.ok) throw new Error(`models ${r.status}`);
            const j = await r.json();
            const models = Array.isArray(j.models) ? j.models : [];
            const options: ModelOption[] = models.map((m: any) => ({ value: m.id, label: m.id }));
            return { provider: p, options };
          })
        );

        const gs: TabGroup[] = [];
        const modelProviderMap: Record<string, string> = {};

        for (let i = 0; i < results.length; i++) {
          const r: any = results[i];
          if (r.status === 'fulfilled' && r.value.options.length > 0) {
            const providerId = r.value.provider.id;
            gs.push({ id: providerId, label: r.value.provider.name || providerId, options: r.value.options });
            r.value.options.forEach((option: any) => {
              modelProviderMap[option.value] = providerId;
            });
          }
        }

        // Flatten options
        const flat = gs.flatMap(g => g.options);

        if (!cancelled) {
          if (gs.length === 0) {
            // leave defaults empty to avoid surprising overrides
            return;
          }
          dispatch({ type: 'SET_MODEL_LIST', payload: { groups: gs, options: flat, modelToProvider: modelProviderMap } });

          // Ensure model belongs to a provider; else pick first
          if (flat.length > 0 && !flat.some((o: any) => o.value === (initialState.model))) {
            dispatch({ type: 'SET_MODEL', payload: flat[0].value });
          }
        }
      } catch {
        // ignore
      }
    }

    loadProvidersAndModels();
    return () => { cancelled = true; };
  }, []);

  // Initialize conversations on mount
  const refreshConversations = useCallback(async () => {
    try {
      dispatch({ type: 'LOAD_CONVERSATIONS_START' });
      const list = await listConversationsApi(undefined, { limit: 20 });
      dispatch({
        type: 'LOAD_CONVERSATIONS_SUCCESS',
        payload: { conversations: list.items, nextCursor: list.next_cursor, replace: true }
      });
      dispatch({ type: 'SET_HISTORY_ENABLED', payload: true });
    } catch (e: any) {
      if (e.status === 501) {
        dispatch({ type: 'SET_HISTORY_ENABLED', payload: false });
      }
      dispatch({ type: 'LOAD_CONVERSATIONS_ERROR' });
    }
  }, []);

  // Initialize conversations on first render
  React.useEffect(() => {
    const timer = setTimeout(() => {
      refreshConversations();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshConversations]);

  // Load sidebar collapsed state from localStorage on mount
  React.useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const collapsed = localStorage.getItem('sidebarCollapsed') === 'true';
        dispatch({ type: 'SET_SIDEBAR_COLLAPSED', payload: collapsed });
        const rightCollapsed = localStorage.getItem('rightSidebarCollapsed') === 'true';
        dispatch({ type: 'SET_RIGHT_SIDEBAR_COLLAPSED', payload: rightCollapsed });
      }
    } catch (e) {
      // ignore storage errors
    }
  }, []);

  // Stream event handler
  const handleStreamToken = useCallback((token: string) => {
    if (!token) return;
    const current = assistantMsgRef.current;
    if (!current) return;
    const assistantId = current.id;

    const nextContent = (current.content ?? '') + token;
    assistantMsgRef.current = { ...current, content: nextContent };
    dispatch({ type: 'STREAM_TOKEN', payload: { messageId: assistantId, token } });
  }, []);

  const handleStreamEvent = useCallback((event: any) => {
    const assistantId = assistantMsgRef.current?.id;
    if (!assistantId) return;

    if (event.type === 'text' || event.type === 'reasoning' || event.type === 'final') {
      return;
    }

    if (event.type === 'tool_call') {
      // Let reducer manage tool_calls to avoid duplicates from local snapshot
      dispatch({ type: 'STREAM_TOOL_CALL', payload: { messageId: assistantId, toolCall: event.value } });
    } else if (event.type === 'tool_output') {
      // Let reducer manage tool_outputs to avoid duplicates from local snapshot
      dispatch({ type: 'STREAM_TOOL_OUTPUT', payload: { messageId: assistantId, toolOutput: event.value } });
    }
  }, []);

  // Helpers to remove duplicate sendChat setup and error handling
  const buildSendChatConfig = useCallback(
    (messages: ChatMessage[], signal: AbortSignal) => {
      // Use inline override if available, otherwise fall back to system prompt
      const effectiveSystemPrompt = (state.inlineSystemPromptOverride || state.systemPrompt || '').trim();

      const outgoing = effectiveSystemPrompt
        ? ([{ role: 'system', content: effectiveSystemPrompt } as any, ...messages])
        : messages;

      const config: any = {
        messages: outgoing.map(m => ({ role: m.role as Role, content: m.content })),
        model: state.model,
        signal,
        conversationId: state.conversationId || undefined,
        systemPrompt: effectiveSystemPrompt || undefined,
        shouldStream: state.shouldStream,
        reasoningEffort: state.reasoningEffort,
        verbosity: state.verbosity,
        qualityLevel: state.qualityLevel,
        onEvent: handleStreamEvent,
        onToken: handleStreamToken,
      };

      // Only add providerId if it's not null
      if (state.providerId) {
        config.providerId = state.providerId;
      }

      // Add tools if enabled
      if (state.useTools && state.enabledTools.length > 0) {
        config.tools = state.enabledTools;
        config.tool_choice = 'auto';
      }

      return config;
    },
    [state, handleStreamEvent, handleStreamToken]
  );

  const runSend = useCallback(
    async (config: Parameters<typeof sendChat>[0]) => {
      try {
        const result = await sendChat(config);
        // For non-streaming requests, ensure the assistant message is populated
        // since there are no incremental text events to update content.
        if (config.shouldStream === false && result?.content) {
          const assistantId = assistantMsgRef.current?.id;
          if (assistantId) {
            dispatch({
              type: 'STREAM_TOKEN',
              payload: { messageId: assistantId, token: result.content },
            });
          }
        }
        // If backend auto-created a conversation, set id and refresh history
        if (result.conversation) {
          dispatch({ type: 'SET_CONVERSATION_ID', payload: result.conversation.id });
          // Refresh to reflect server ordering/title rather than optimistic add
          void refreshConversations();
        }
        // Sync the assistant message from the latest snapshot and the final content
        if (assistantMsgRef.current) {
          const merged = { ...assistantMsgRef.current };
          if (result?.content) merged.content = result.content;
          dispatch({ type: 'SYNC_ASSISTANT', payload: merged });
        }
        dispatch({
          type: 'STREAM_COMPLETE',
          payload: { responseId: result.responseId },
        });
      } catch (e: any) {
        let displayError = 'An unexpected error occurred.';

        // Duck-typing for APIError
        if (e && typeof e.status === 'number' && e.body) {
          if (e.body && typeof e.body === 'object') {
            let detail = e.body.error?.message || e.body.message;
            if (e.body.error?.metadata?.raw) {
              try {
                const rawError = JSON.parse(e.body.error.metadata.raw);
                detail = rawError.error?.message || detail;
              } catch (parseError) {
                // Failed to parse raw error metadata
              }
            }
            displayError = `HTTP ${e.status}: ${detail || 'An unknown error occurred.'}`;
          } else {
            displayError = e.message;
          }
        } else if (e instanceof Error) {
          displayError = e.message;
        } else {
          displayError = String(e);
        }

        // Append error message to the assistant bubble for visibility
        const assistantId = assistantMsgRef.current?.id;
        if (assistantId) {
          dispatch({ type: 'STREAM_TOKEN', payload: { messageId: assistantId, token: `\n[error: ${displayError}]` } });
        }
        dispatch({ type: 'STREAM_ERROR', payload: displayError });
      } finally {
        inFlightRef.current = false;
      }
    },
    [state.model, refreshConversations]
  );

  // Actions
  const actions = {
    // Authentication Actions
    setUser: useCallback((user: User | null) => {
      dispatch({ type: 'SET_USER', payload: user });
    }, []),

    setAuthenticated: useCallback((authenticated: boolean) => {
      dispatch({ type: 'SET_AUTHENTICATED', payload: authenticated });
    }, []),

    // UI Actions
    setInput: useCallback((input: string) => {
      dispatch({ type: 'SET_INPUT', payload: input });
    }, []),

    setModel: useCallback((model: string) => {
      dispatch({ type: 'SET_MODEL', payload: model });
    }, []),

    setProviderId: useCallback((providerId: string | null) => {
      dispatch({ type: 'SET_PROVIDER_ID', payload: providerId });
    }, []),

    setUseTools: useCallback((useTools: boolean) => {
      dispatch({ type: 'SET_USE_TOOLS', payload: useTools });
    }, []),

    setShouldStream: useCallback((shouldStream: boolean) => {
      dispatch({ type: 'SET_SHOULD_STREAM', payload: shouldStream });
    }, []),

    setReasoningEffort: useCallback((effort: string) => {
      dispatch({ type: 'SET_REASONING_EFFORT', payload: effort });
    }, []),

    setVerbosity: useCallback((verbosity: string) => {
      dispatch({ type: 'SET_VERBOSITY', payload: verbosity });
    }, []),


    setQualityLevel: useCallback((level: QualityLevel) => {
      dispatch({ type: 'SET_QUALITY_LEVEL', payload: level });
    }, []),

    setSystemPrompt: useCallback((prompt: string) => {
      dispatch({ type: 'SET_SYSTEM_PROMPT', payload: prompt });
    }, []),

    setInlineSystemPromptOverride: useCallback((prompt: string) => {
      dispatch({ type: 'SET_INLINE_SYSTEM_PROMPT_OVERRIDE', payload: prompt });
    }, []),

    setEnabledTools: useCallback((list: string[]) => {
      dispatch({ type: 'SET_ENABLED_TOOLS', payload: list });
    }, []),

    // Chat Actions
    sendMessage: useCallback(async () => {
      const input = state.input.trim();
      if (!input || state.status === 'streaming' || inFlightRef.current) return;

      inFlightRef.current = true;
      const abort = new AbortController();
      const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: input };
      const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' };
      assistantMsgRef.current = assistantMsg;

      dispatch({
        type: 'START_STREAMING',
        payload: { abort, userMessage: userMsg, assistantMessage: assistantMsg }
      });

      // Ensure the START_STREAMING state is applied before streaming events arrive
      await new Promise(resolve => setTimeout(resolve, 0));

      const config = buildSendChatConfig([...state.messages, userMsg], abort.signal);
      await runSend(config);
    }, [state, handleStreamEvent, buildSendChatConfig, runSend]),

    regenerate: useCallback(async (baseMessages: ChatMessage[]) => {
      if (state.status === 'streaming' || inFlightRef.current) return;

      inFlightRef.current = true;
      const abort = new AbortController();
      const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' };
      assistantMsgRef.current = assistantMsg;

      dispatch({
        type: 'REGENERATE_START',
        payload: { abort, baseMessages, assistantMessage: assistantMsg }
      });

      // Ensure state commit before events arrive
      await new Promise(resolve => setTimeout(resolve, 0));

      const config = buildSendChatConfig(baseMessages, abort.signal);
      await runSend(config);
    }, [state, handleStreamEvent, buildSendChatConfig, runSend]),

    stopStreaming: useCallback(() => {
      try { state.abort?.abort(); } catch {}
      inFlightRef.current = false;
      dispatch({ type: 'STOP_STREAMING' });
    }, [state.abort]),

    newChat: useCallback(async () => {
      if (state.status === 'streaming') {
        actions.stopStreaming();
      }

      // Align with v1 behavior: don't pre-create; first send will autocreate
      // and the sidebar will refresh on `_conversation` signal.
      dispatch({ type: 'NEW_CHAT' });
    }, [state.status]),

    // Conversation Actions
    selectConversation: useCallback(async (id: string) => {
      if (state.status === 'streaming') {
        actions.stopStreaming();
      }

      dispatch({ type: 'SET_CONVERSATION_ID', payload: id });
      dispatch({ type: 'CLEAR_MESSAGES' });
      dispatch({ type: 'CANCEL_EDIT' });

      try {
        const data = await getConversationApi(undefined, id, { limit: 200 });
        const msgs = data.messages.map(m => ({
          id: String(m.id),
          role: m.role as Role,
          content: m.content || ''
        }));
        dispatch({ type: 'SET_MESSAGES', payload: msgs });

        // Apply conversation-level settings from API response
        if (data.model) {
          dispatch({ type: 'SET_MODEL', payload: data.model });
        }
        if (data.streaming_enabled !== undefined) {
          dispatch({ type: 'SET_SHOULD_STREAM', payload: data.streaming_enabled });
        }
        if (data.tools_enabled !== undefined) {
          dispatch({ type: 'SET_USE_TOOLS', payload: data.tools_enabled });
        }
        const activeTools = Array.isArray((data as any).active_tools)
          ? (data as any).active_tools
          : Array.isArray((data as any).metadata?.active_tools)
            ? (data as any).metadata.active_tools
            : undefined;
        if (Array.isArray(activeTools)) {
          dispatch({ type: 'SET_ENABLED_TOOLS', payload: activeTools });
        } else if (data.tools_enabled === false) {
          dispatch({ type: 'SET_ENABLED_TOOLS', payload: [] });
        }
        if (data.quality_level) {
          dispatch({ type: 'SET_QUALITY_LEVEL', payload: data.quality_level as QualityLevel });
        }
        if (data.reasoning_effort) {
          dispatch({ type: 'SET_REASONING_EFFORT', payload: data.reasoning_effort });
        }
        if (data.verbosity) {
          dispatch({ type: 'SET_VERBOSITY', payload: data.verbosity });
        }
        if (typeof (data as any).system_prompt === 'string') {
          dispatch({ type: 'SET_SYSTEM_PROMPT', payload: (data as any).system_prompt || '' });
        }
        if ((data as any).active_system_prompt_id !== undefined) {
          dispatch({ type: 'SET_ACTIVE_SYSTEM_PROMPT_ID', payload: (data as any).active_system_prompt_id });
        }
      } catch (e: any) {
        // ignore
      }
    }, [state.status]),

    loadMoreConversations: useCallback(async () => {
      if (!state.nextCursor || state.loadingConversations) return;

      dispatch({ type: 'LOAD_CONVERSATIONS_START' });
      try {
        const list = await listConversationsApi(undefined, { cursor: state.nextCursor, limit: 20 });
        dispatch({
          type: 'LOAD_CONVERSATIONS_SUCCESS',
          payload: { conversations: list.items, nextCursor: list.next_cursor }
        });
      } catch (e: any) {
        dispatch({ type: 'LOAD_CONVERSATIONS_ERROR' });
      }
    }, [state.nextCursor, state.loadingConversations]),

    deleteConversation: useCallback(async (id: string) => {
      try {
        await deleteConversationApi(undefined, id);
        dispatch({ type: 'DELETE_CONVERSATION', payload: id });
      } catch (e: any) {
        // ignore
      }
    }, []),

    // Editing Actions
    startEdit: useCallback((messageId: string, content: string) => {
      dispatch({ type: 'START_EDIT', payload: { messageId, content } });
    }, []),

    updateEditContent: useCallback((content: string) => {
      dispatch({ type: 'UPDATE_EDIT_CONTENT', payload: content });
    }, []),

    cancelEdit: useCallback(() => {
      dispatch({ type: 'CANCEL_EDIT' });
    }, []),

    saveEdit: useCallback(async () => {
      if (!state.editingMessageId || !state.editingContent.trim()) return;

      const messageId = state.editingMessageId;
      const newContent = state.editingContent.trim();

      // Find base messages (up to and including edited message)
      const idx = state.messages.findIndex(m => m.id === messageId);
      if (idx === -1) return;

      const baseMessages = [
        ...state.messages.slice(0, idx),
        { ...state.messages[idx], content: newContent }
      ];

      dispatch({
        type: 'SAVE_EDIT_SUCCESS',
        payload: { messageId, content: newContent, baseMessages }
      });

      // If last message is user message, regenerate response
      if (baseMessages.length > 0 && baseMessages[baseMessages.length - 1].role === 'user') {
        // Trigger regeneration (similar to sendMessage but with existing messages)
        // This would be implemented similar to the current regenerateFromBase logic
      }
    }, [state.editingMessageId, state.editingContent, state.messages]),

    setMessages: useCallback((messages: ChatMessage[]) => {
      dispatch({ type: 'SET_MESSAGES', payload: messages });
    }, []),

    refreshConversations,

    toggleSidebar: useCallback(() => {
      dispatch({ type: 'TOGGLE_SIDEBAR' });
    }, []),

    toggleRightSidebar: useCallback(() => {
      dispatch({ type: 'TOGGLE_RIGHT_SIDEBAR' });
    }, []),
  };

  return { state, actions };
}
