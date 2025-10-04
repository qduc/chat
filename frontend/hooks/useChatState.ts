import React, { useReducer, useCallback, useRef, useEffect, useMemo } from 'react';
import type { ChatMessage, Role } from '../lib/chat';
import type { Group as TabGroup, Option as ModelOption } from '../components/ui/TabbedSelect';
import { sendChat, ConversationManager } from '../lib/chat';
import { useAuth } from '../contexts/AuthContext';
import { httpClient } from '../lib/http/client';
import { extractTextFromContent, stringToMessageContent } from '../lib/chat/content-utils';

// Import from refactored modules
import type { ChatState, ChatAction, PendingState, ToolSpec } from './useChatState/types';
import { initialState } from './useChatState/initialState';
import { chatReducer } from './useChatState/reducer';
import {
  createAuthActions,
  createUiActions,
  createSettingsActions,
  createChatActions,
  createConversationActions,
  createEditActions,
} from './useChatState/actions';

// Re-export types for backwards compatibility
export type { PendingState, ChatState, ChatAction, ToolSpec };

// Note: ChatState, ChatAction, initialState, chatReducer, and utilities are now imported from ./useChatState/

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
  const activeSystemPromptIdRef = useRef(state.activeSystemPromptId);
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
    activeSystemPromptIdRef.current = state.activeSystemPromptId;
    // Keep chat parameter refs in sync
    shouldStreamRef.current = state.shouldStream;
    reasoningEffortRef.current = state.reasoningEffort;
    verbosityRef.current = state.verbosity;
    qualityLevelRef.current = state.qualityLevel;
  }, [state.model, state.systemPrompt, state.inlineSystemPromptOverride, state.activeSystemPromptId, state.shouldStream, state.reasoningEffort, state.verbosity, state.qualityLevel]);

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
    try {
      dispatch({ type: 'SET_LOADING_MODELS', payload: true });
      const response = await httpClient.get<{ providers: any[] }>('/v1/providers');
      const providers: any[] = Array.isArray(response.data.providers) ? response.data.providers : [];
      const enabledProviders = providers.filter(p => p?.enabled);
      if (!enabledProviders.length) {
        dispatch({ type: 'SET_LOADING_MODELS', payload: false });
        return;
      }

      const results = await Promise.allSettled(
        enabledProviders.map(async (p) => {
          const modelsResponse = await httpClient.get<{ models: any[] }>(`/v1/providers/${encodeURIComponent(p.id)}/models`);
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
        // Load saved model from localStorage
        const savedModel = localStorage.getItem('selectedModel');
        if (savedModel) {
          dispatch({ type: 'SET_MODEL', payload: savedModel });
        }
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
    const currentText = extractTextFromContent(current.content);
    const nextContent = stringToMessageContent(currentText + token);
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
              fullContent: extractTextFromContent(assistantMsgRef.current.content) // Pass full content as string
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
      const currentContentLength = extractTextFromContent(assistantMsgRef.current?.content || '').length;
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
    } else if (event.type === 'usage') {
      // Store usage metadata in the assistant message
      dispatch({ type: 'STREAM_USAGE', payload: { messageId: assistantId, usage: event.value } });
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
        activeSystemPromptId: activeSystemPromptIdRef.current || undefined,
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
            // Also store usage data from the result for non-streaming responses
            if (result.usage) {
              dispatch({
                type: 'STREAM_USAGE',
                payload: { messageId: assistantId, usage: result.usage },
              });
            }
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
                fullContent: extractTextFromContent(assistantMsgRef.current.content)
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
  const actions = useMemo(() => {
    // Create action objects using the extracted action creators
    const authActions = createAuthActions({ dispatch });
    const uiActions = createUiActions({ dispatch });
    const settingsActions = createSettingsActions({
      dispatch,
      modelRef,
      providerRef,
      systemPromptRef,
      inlineSystemPromptRef,
      activeSystemPromptIdRef,
      shouldStreamRef,
      reasoningEffortRef,
      verbosityRef,
      qualityLevelRef,
      loadProvidersAndModels,
    });

    // Create a stopStreaming function for use by chat and conversation actions
    const stopStreaming = () => {
      // Flush any pending throttled updates
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      try { state.abort?.abort(); } catch {}
      inFlightRef.current = false;
      dispatch({ type: 'STOP_STREAMING' });
    };

    const chatActions = createChatActions({
      state,
      dispatch,
      inFlightRef,
      assistantMsgRef,
      throttleTimerRef,
      buildSendChatConfig,
      runSend,
    });

    // Override chatActions' stopStreaming and newChat with stable versions
    const stableChatActions = {
      ...chatActions,
      stopStreaming,
      newChat: async () => {
        if (state.status === 'streaming') {
          stopStreaming();
        }
        dispatch({ type: 'NEW_CHAT' });
      },
    };

    const conversationActions = createConversationActions({
      state,
      dispatch,
      conversationManager,
      stopStreaming,
    });

    const editActions = createEditActions({
      state,
      dispatch,
    });

    return {
      ...authActions,
      ...uiActions,
      ...settingsActions,
      ...stableChatActions,
      ...conversationActions,
      ...editActions,
      refreshConversations,
    };
  }, [
    dispatch,
    modelRef,
    providerRef,
    systemPromptRef,
    inlineSystemPromptRef,
    activeSystemPromptIdRef,
    shouldStreamRef,
    reasoningEffortRef,
    verbosityRef,
    qualityLevelRef,
    loadProvidersAndModels,
    state,
    inFlightRef,
    assistantMsgRef,
    throttleTimerRef,
    buildSendChatConfig,
    runSend,
    conversationManager,
    refreshConversations,
  ]);

  return { state, actions };
}
