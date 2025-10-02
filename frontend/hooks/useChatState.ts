import React, { useReducer, useCallback, useRef, useEffect, useMemo } from 'react';
import type { ChatMessage, Role, ConversationMeta } from '../lib/chat';
import type { Group as TabGroup, Option as ModelOption } from '../components/ui/TabbedSelect';
import { sendChat, getConversationApi, listConversationsApi, deleteConversationApi, editMessageApi, ConversationManager } from '../lib/chat';
import type { QualityLevel } from '../components/ui/QualitySlider';
import type { User } from '../lib/auth/api';
import { useAuth } from '../contexts/AuthContext';
import { httpClient } from '../lib/http/client';
import { HttpError } from '../lib/http/types';

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
  currentConversationTitle: string | null;
  previousResponseId: string | null;
  // ...existing code...

  // Settings
  model: string;
  providerId: string | null;
  // Model listing fetched from backend providers
  modelOptions: ModelOption[];
  modelGroups: TabGroup[] | null;
  modelToProvider: Record<string, string>;
  modelCapabilities: Record<string, any>; // Store model capabilities (e.g., supported_parameters)
  isLoadingModels: boolean;
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
  | { type: 'SET_CURRENT_CONVERSATION_TITLE'; payload: string | null }
  | { type: 'START_STREAMING'; payload: { abort: AbortController; userMessage: ChatMessage; assistantMessage: ChatMessage } }
  | { type: 'REGENERATE_START'; payload: { abort: AbortController; baseMessages: ChatMessage[]; assistantMessage: ChatMessage } }
  | { type: 'STREAM_TOKEN'; payload: { messageId: string; token: string; fullContent?: string } }
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
  | { type: 'SET_MODEL_LIST'; payload: { groups: TabGroup[] | null; options: ModelOption[]; modelToProvider: Record<string, string>; modelCapabilities: Record<string, any> } }
  | { type: 'SET_LOADING_MODELS'; payload: boolean };

const initialState: ChatState = {
  // Authentication State
  user: null,
  isAuthenticated: false,

  status: 'idle',
  input: '',
  messages: [],
  conversationId: null,
  currentConversationTitle: null,
  previousResponseId: null,
  model: 'gpt-4.1-mini',
  providerId: null,
  modelOptions: [],
  modelGroups: null,
  modelToProvider: {},
  modelCapabilities: {},
  isLoadingModels: false,
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
      return {
        ...state,
        conversationId: action.payload,
        // Reset previousResponseId when switching conversations
        previousResponseId: null
      };

    case 'SET_CURRENT_CONVERSATION_TITLE':
      return {
        ...state,
        currentConversationTitle: action.payload
      };

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
            // Use fullContent if provided, otherwise append token
            const newContent = action.payload.fullContent !== undefined
              ? action.payload.fullContent
              : (m.content ?? '') + action.payload.token;
            return { ...m, content: newContent };
          }
          return m;
        });
        if (!updated) {
          // Fallback: update the last assistant message if present
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === 'assistant') {
              const newContent = action.payload.fullContent !== undefined
                ? action.payload.fullContent
                : (next[i].content ?? '') + action.payload.token;
              next[i] = { ...next[i], content: newContent } as any;
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

          const resolveTextOffset = (prevOffset: any, nextOffset: any) => {
            const asNumber = (value: any) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
            const prev = asNumber(prevOffset);
            const next = asNumber(nextOffset);
            if (prev !== undefined) return prev;
            if (next !== undefined) return next;
            return undefined;
          };

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
              textOffset: resolveTextOffset(prev?.textOffset, incoming?.textOffset),
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
                textOffset: resolveTextOffset(prev?.textOffset, incoming?.textOffset),
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
                textOffset: resolveTextOffset(prev?.textOffset, incoming?.textOffset),
                function: mergeArgs(prev.function, incoming.function)
              };
              return out;
            }
          }

          out.push({ ...incoming });
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
        previousResponseId: action.payload.responseId || state.previousResponseId,
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
        previousResponseId: null,
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
        messages: state.conversationId === action.payload ? [] : state.messages,
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
        currentConversationTitle: null,
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
        modelToProvider: action.payload.modelToProvider || {},
        modelCapabilities: action.payload.modelCapabilities || {}
      };

    case 'SET_LOADING_MODELS':
      return { ...state, isLoadingModels: action.payload };

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
  const { user, ready: authReady } = useAuth();
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const assistantMsgRef = useRef<ChatMessage | null>(null);
  const inFlightRef = useRef<boolean>(false);
  const modelRef = useRef(state.model);
  const providerRef = useRef<string | null>(null);
  // Keep synchronous refs for system prompt values so immediate actions
  // (like regenerate/send) can use the newest prompt without waiting for
  // React state to flush.
  const systemPromptRef = useRef(state.systemPrompt);
  const inlineSystemPromptRef = useRef(state.inlineSystemPromptOverride);
  // Keep synchronous refs for chat parameters to avoid race conditions
  const shouldStreamRef = useRef(state.shouldStream);
  const reasoningEffortRef = useRef(state.reasoningEffort);
  const verbosityRef = useRef(state.verbosity);
  const qualityLevelRef = useRef(state.qualityLevel);
  const conversationManager = useMemo(() => new ConversationManager(), []);
  const throttleTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    modelRef.current = state.model;
    // Keep prompt refs in sync when state changes (covers updates coming
    // from other places than our setters, e.g. loading a conversation).
    // Include prompts in the dependency list so they update as soon as
    // state changes.
    systemPromptRef.current = state.systemPrompt;
    inlineSystemPromptRef.current = state.inlineSystemPromptOverride;
    // Keep chat parameter refs in sync
    shouldStreamRef.current = state.shouldStream;
    reasoningEffortRef.current = state.reasoningEffort;
    verbosityRef.current = state.verbosity;
    qualityLevelRef.current = state.qualityLevel;
  }, [state.model, state.systemPrompt, state.inlineSystemPromptOverride, state.shouldStream, state.reasoningEffort, state.verbosity, state.qualityLevel]);

  // Sync authentication state from AuthContext
  useEffect(() => {
    if (authReady) {
      dispatch({ type: 'SET_USER', payload: user });
    }
  }, [user, authReady]);

  // Load models/providers centrally (moved from ChatHeader local state)
  const loadProvidersAndModels = useCallback(async () => {
    if (!authReady || !user) {
      return;
    }
    const apiBase = (process.env.NEXT_PUBLIC_API_BASE as string) ?? 'http://localhost:3001';
    try {
      dispatch({ type: 'SET_LOADING_MODELS', payload: true });
      const response = await httpClient.get<{ providers: any[] }>(`${apiBase}/v1/providers`);
      const providers: any[] = Array.isArray(response.data.providers) ? response.data.providers : [];
      const enabledProviders = providers.filter(p => p?.enabled);
      if (!enabledProviders.length) {
        dispatch({ type: 'SET_LOADING_MODELS', payload: false });
        return;
      }

      const results = await Promise.allSettled(
        enabledProviders.map(async (p) => {
          const modelsResponse = await httpClient.get<{ models: any[] }>(`${apiBase}/v1/providers/${encodeURIComponent(p.id)}/models`);
          const models = Array.isArray(modelsResponse.data.models) ? modelsResponse.data.models : [];
          const options: ModelOption[] = models.map((m: any) => ({ value: m.id, label: m.id }));
          return { provider: p, options, models };
        })
      );

      const gs: TabGroup[] = [];
      const modelProviderMap: Record<string, string> = {};
      const modelCapabilitiesMap: Record<string, any> = {};

      for (let i = 0; i < results.length; i++) {
        const r: any = results[i];
        if (r.status === 'fulfilled' && r.value.options.length > 0) {
          const providerId = r.value.provider.id;
          gs.push({ id: providerId, label: r.value.provider.name || providerId, options: r.value.options });
          r.value.options.forEach((option: any) => {
            modelProviderMap[option.value] = providerId;
          });
          // Store model capabilities (e.g., supported_parameters from OpenRouter)
          r.value.models.forEach((m: any) => {
            if (m && m.id) {
              modelCapabilitiesMap[m.id] = m;
            }
          });
        }
      }

      const flat = gs.flatMap(g => g.options);
      if (gs.length === 0) {
        dispatch({ type: 'SET_LOADING_MODELS', payload: false });
        return;
      }

      dispatch({ type: 'SET_MODEL_LIST', payload: { groups: gs, options: flat, modelToProvider: modelProviderMap, modelCapabilities: modelCapabilitiesMap } });

      // Ensure current model exists in the new list, otherwise pick first
      const currentModel = modelRef.current;
      if (flat.length > 0 && !flat.some((o: any) => o.value === currentModel)) {
        const fallbackModel = flat[0].value;
        modelRef.current = fallbackModel;
        dispatch({ type: 'SET_MODEL', payload: fallbackModel });
      }
    } catch (e) {
      // ignore
    } finally {
      dispatch({ type: 'SET_LOADING_MODELS', payload: false });
    }
  }, [authReady, user]);

  // Call loader on mount
  useEffect(() => {
    if (!authReady) {
      return;
    }
    void loadProvidersAndModels();
  }, [authReady, loadProvidersAndModels]);

  // Listen for external provider change events to refresh models
  useEffect(() => {
    const handler = () => { void loadProvidersAndModels(); };
    if (typeof window !== 'undefined') {
      window.addEventListener('chat:providers_changed', handler as EventListener);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('chat:providers_changed', handler as EventListener);
      }
    };
  }, [loadProvidersAndModels]);

  // Initialize conversations on mount
  const refreshConversations = useCallback(async () => {
    if (!authReady) {
      return;
    }

    if (!user) {
      dispatch({
        type: 'LOAD_CONVERSATIONS_SUCCESS',
        payload: { conversations: [], nextCursor: null, replace: true }
      });
      dispatch({ type: 'SET_HISTORY_ENABLED', payload: false });
      return;
    }

    try {
      dispatch({ type: 'LOAD_CONVERSATIONS_START' });
      const list = await conversationManager.list({ limit: 20 });
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
  }, [authReady, user, conversationManager]);

  // Initialize conversations on first render
  React.useEffect(() => {
    if (!authReady) {
      return;
    }
    const timer = setTimeout(() => {
      void refreshConversations();
    }, 0);
    return () => clearTimeout(timer);
  }, [authReady, refreshConversations]);

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

    // Immediately update the ref (keeps tokens flowing)
    const nextContent = (current.content ?? '') + token;
    assistantMsgRef.current = { ...current, content: nextContent };

    // Throttle React state updates to 60fps
    if (!throttleTimerRef.current) {
      throttleTimerRef.current = setTimeout(() => {
        if (assistantMsgRef.current) {
          dispatch({
            type: 'STREAM_TOKEN',
            payload: {
              messageId: assistantId,
              token: '', // Token already in ref
              fullContent: assistantMsgRef.current.content // Pass full content
            }
          });
        }
        throttleTimerRef.current = null;
      }, 16); // ~60fps
    }
  }, []);

  const handleStreamEvent = useCallback((event: any) => {
    const assistantId = assistantMsgRef.current?.id;
    if (!assistantId) return;

    if (event.type === 'text' || event.type === 'reasoning' || event.type === 'final') {
      return;
    }

    if (event.type === 'tool_call') {
      const currentContentLength = assistantMsgRef.current?.content?.length ?? 0;
      const toolCallValue = event.value && typeof event.value === 'object'
        ? {
            ...event.value,
            ...(event.value.function ? { function: { ...event.value.function } } : {}),
            textOffset: currentContentLength,
          }
        : event.value;

      // Let reducer manage tool_calls to avoid duplicates from local snapshot
      dispatch({ type: 'STREAM_TOOL_CALL', payload: { messageId: assistantId, toolCall: toolCallValue } });
    } else if (event.type === 'tool_output') {
      // Let reducer manage tool_outputs to avoid duplicates from local snapshot
      dispatch({ type: 'STREAM_TOOL_OUTPUT', payload: { messageId: assistantId, toolOutput: event.value } });
    }
  }, []);

  // Helpers to remove duplicate sendChat setup and error handling
  const buildSendChatConfig = useCallback(
    (messages: ChatMessage[], signal: AbortSignal) => {
  // Use inline override if available, otherwise fall back to system prompt.
  // Read from refs so callers (send/regenerate) get the most recent
  // value immediately even if React state hasn't committed yet.
  const effectiveSystemPrompt = ((inlineSystemPromptRef.current || systemPromptRef.current) || '').trim();

      const outgoing = effectiveSystemPrompt
        ? ([{ role: 'system', content: effectiveSystemPrompt } as any, ...messages])
        : messages;

      const config: any = {
        messages: outgoing.map(m => ({ role: m.role as Role, content: m.content })),
        // Prefer the synchronous ref which is updated immediately when the user
        // selects a model. This avoids a race where a model change dispatch
        // hasn't flushed to React state yet but an immediate regenerate/send
        // should use the newly selected model.
        model: modelRef.current,
        signal,
        conversationId: state.conversationId || undefined,
        responseId: state.previousResponseId || undefined,
        systemPrompt: effectiveSystemPrompt || undefined,
        activeSystemPromptId: state.activeSystemPromptId || undefined,
        // Use refs for chat parameters to ensure immediate updates are used
        shouldStream: shouldStreamRef.current,
        reasoningEffort: reasoningEffortRef.current,
        verbosity: verbosityRef.current,
        qualityLevel: qualityLevelRef.current,
        modelCapabilities: state.modelCapabilities,
        onEvent: handleStreamEvent,
        onToken: handleStreamToken,
      };

      // Only add providerId if it's not null
      if (state.providerId) {
        config.providerId = providerRef.current || state.providerId;
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
          // Clear cached list and refresh to reflect server ordering/title rather than optimistic add
          try {
            // Invalidate any cached conversation list in the manager so list() makes a real network request
            (conversationManager as any)?.clearListCache?.();
          } catch (_) {}
          void refreshConversations();
        }
        // Sync the assistant message from the latest snapshot and the final content
        if (assistantMsgRef.current) {
          const merged = { ...assistantMsgRef.current };
          if (result?.content) merged.content = result.content;
          dispatch({ type: 'SYNC_ASSISTANT', payload: merged });
        }
        // Flush any pending throttled updates before completing
        if (throttleTimerRef.current) {
          clearTimeout(throttleTimerRef.current);
          throttleTimerRef.current = null;
          // Final sync with accumulated content
          if (assistantMsgRef.current) {
            dispatch({
              type: 'STREAM_TOKEN',
              payload: {
                messageId: assistantMsgRef.current.id,
                token: '',
                fullContent: assistantMsgRef.current.content
              }
            });
          }
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
      // Update the ref immediately so subsequent actions (like regenerate)
      // that read modelRef.current will use the newly selected model even if
      // React state hasn't committed yet.
      modelRef.current = model;
      dispatch({ type: 'SET_MODEL', payload: model });
    }, []),

    setProviderId: useCallback((providerId: string | null) => {
      providerRef.current = providerId;
      dispatch({ type: 'SET_PROVIDER_ID', payload: providerId });
    }, []),

    setUseTools: useCallback((useTools: boolean) => {
      dispatch({ type: 'SET_USE_TOOLS', payload: useTools });
    }, []),

    setShouldStream: useCallback((shouldStream: boolean) => {
      shouldStreamRef.current = shouldStream;
      dispatch({ type: 'SET_SHOULD_STREAM', payload: shouldStream });
    }, []),

    setReasoningEffort: useCallback((effort: string) => {
      reasoningEffortRef.current = effort;
      dispatch({ type: 'SET_REASONING_EFFORT', payload: effort });
    }, []),

    setVerbosity: useCallback((verbosity: string) => {
      verbosityRef.current = verbosity;
      dispatch({ type: 'SET_VERBOSITY', payload: verbosity });
    }, []),


    setQualityLevel: useCallback((level: QualityLevel) => {
      // Update refs synchronously for immediate use
      qualityLevelRef.current = level;
      // Also update derived refs based on quality level mapping
      const map: Record<QualityLevel, { reasoningEffort: string; verbosity: string }> = {
        quick: { reasoningEffort: 'minimal', verbosity: 'low' },
        balanced: { reasoningEffort: 'medium', verbosity: 'medium' },
        thorough: { reasoningEffort: 'high', verbosity: 'high' },
      };
      const derived = map[level];
      reasoningEffortRef.current = derived.reasoningEffort;
      verbosityRef.current = derived.verbosity;
      dispatch({ type: 'SET_QUALITY_LEVEL', payload: level });
    }, []),

    setSystemPrompt: useCallback((prompt: string) => {
      // Update ref synchronously so immediate send/regenerate uses new prompt
      systemPromptRef.current = prompt;
      dispatch({ type: 'SET_SYSTEM_PROMPT', payload: prompt });
    }, []),

    setInlineSystemPromptOverride: useCallback((prompt: string) => {
      // Update both refs synchronously to ensure immediate use by send/regenerate
      inlineSystemPromptRef.current = prompt;
      systemPromptRef.current = prompt;
      dispatch({ type: 'SET_INLINE_SYSTEM_PROMPT_OVERRIDE', payload: prompt });
      dispatch({ type: 'SET_SYSTEM_PROMPT', payload: prompt });
    }, []),

    setActiveSystemPromptId: useCallback((id: string | null) => {
      dispatch({ type: 'SET_ACTIVE_SYSTEM_PROMPT_ID', payload: id });
    }, []),

    setEnabledTools: useCallback((list: string[]) => {
      dispatch({ type: 'SET_ENABLED_TOOLS', payload: list });
    }, []),

    // Model list refresh action (triggered by UI or external events)
    refreshModelList: useCallback(async () => {
      await loadProvidersAndModels();
    }, [loadProvidersAndModels]),

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
      // Flush any pending throttled updates
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
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
        const data = await conversationManager.get(id, { limit: 200 });
        const msgs = data.messages.map(m => ({
          id: String(m.id),
          role: m.role as Role,
          content: m.content || '',
          ...(m.tool_calls && { tool_calls: m.tool_calls }),
          ...(m.tool_outputs && { tool_outputs: m.tool_outputs })
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
        // Always update system_prompt if present in response (including null)
        if ('system_prompt' in (data as any)) {
          dispatch({ type: 'SET_SYSTEM_PROMPT', payload: (data as any).system_prompt || '' });
        }
        // Always update active_system_prompt_id if present in response (including null)
        if ('active_system_prompt_id' in (data as any)) {
          dispatch({ type: 'SET_ACTIVE_SYSTEM_PROMPT_ID', payload: (data as any).active_system_prompt_id });
        }
        // Set the current conversation title if available
        if (data.title) {
          dispatch({ type: 'SET_CURRENT_CONVERSATION_TITLE', payload: data.title });
        }
      } catch (e: any) {
        // ignore
      }
    }, [state.status, conversationManager]),

    loadMoreConversations: useCallback(async () => {
      if (!state.nextCursor || state.loadingConversations) return;

      dispatch({ type: 'LOAD_CONVERSATIONS_START' });
      try {
        const list = await conversationManager.list({ cursor: state.nextCursor, limit: 20 });
        dispatch({
          type: 'LOAD_CONVERSATIONS_SUCCESS',
          payload: { conversations: list.items, nextCursor: list.next_cursor }
        });
      } catch (e: any) {
        dispatch({ type: 'LOAD_CONVERSATIONS_ERROR' });
      }
    }, [state.nextCursor, state.loadingConversations, conversationManager]),

    deleteConversation: useCallback(async (id: string) => {
      try {
        await conversationManager.delete(id);
        dispatch({ type: 'DELETE_CONVERSATION', payload: id });
      } catch (e: any) {
        // ignore
      }
    }, [conversationManager]),

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

    loadProvidersAndModels,
  };

  return { state, actions };
}
